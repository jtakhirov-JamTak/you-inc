// Habit creation — build the roster (the balance-sheet positions). One habit per
// call; the roster's FIXED shape (1 morning + 1 daily + 1 weekly asset + 2 vices)
// is enforced server-side against the caller's live, active roster.
//
// Handler order: origin → auth → rate-limit → validate → gate(roster) → insert.
//
// Notes:
//  - The owner is the session user; user_id is never taken from the body, and
//    RLS re-checks on insert.
//  - term_started_on / the every_n_days anchor are stamped from the user's
//    timezone (user_settings), consistent with how settlement buckets dates.
//  - v0: the roster cap is an app-level check, not a DB constraint, so two truly
//    simultaneous creates could both pass. Acceptable for a solo user; a partial
//    unique index can harden it later.
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getAuthUser, createClient } from "@/lib/supabase/server";
import { createHabitSchema, type RecurrenceInput } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { checkOrigin } from "@/lib/check-origin";
import { localDateInTz } from "@/lib/price/dates";
import { validateRosterAddition, type RosterSlot } from "@/lib/habits/roster";

export const runtime = "nodejs";

// Build the stored recurrence_rule from the client's input. weekdays are sorted
// + deduped; every_n_days gets the habit's start date as its anchor.
function buildRecurrenceRule(input: RecurrenceInput, anchor: string) {
  if (input.type === "weekdays") {
    return { type: "weekdays" as const, days: [...new Set(input.days)].sort((a, b) => a - b) };
  }
  return { type: "every_n_days" as const, n: input.n, anchor };
}

export async function POST(req: Request) {
  // 1. Origin.
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 2. Auth.
  const {
    data: { user },
    error: authError,
  } = await getAuthUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 3. Rate limit.
  const rl = await rateLimit(`habits:create:${user.id}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  // 4. Validate.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createHabitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const input = parsed.data;

  const supabase = await createClient();

  // 5. Gate — enforce the roster cap against the caller's ACTIVE habits. Check
  //    .error BEFORE deciding: a failed read must not look like an empty roster
  //    (which would wave every addition through).
  const { data: existing, error: rosterError } = await supabase
    .from("habits")
    .select("kind, cadence")
    .eq("user_id", user.id)
    .eq("status", "active");
  if (rosterError) {
    console.error("habit create: roster read failed", rosterError.code);
    Sentry.captureException(new Error("habit_create_roster_read_failed"), {
      tags: { area: "habits", kind: "roster_read_failed" },
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  const proposed: RosterSlot = {
    kind: input.kind,
    cadence: input.kind === "asset" ? input.cadence : null,
  };
  const rosterErr = validateRosterAddition(
    (existing ?? []) as RosterSlot[],
    proposed,
  );
  if (rosterErr) {
    return NextResponse.json({ error: rosterErr.message }, { status: 409 });
  }

  // Today in the user's timezone — for term_started_on and the recurrence anchor.
  const { data: settings } = await supabase
    .from("user_settings")
    .select("timezone")
    .eq("user_id", user.id)
    .maybeSingle();
  let today: string;
  try {
    today = localDateInTz(new Date(), settings?.timezone || "UTC");
  } catch {
    today = localDateInTz(new Date(), "UTC");
  }

  // 6. Insert. user_id from the session; defaults fill created_at/status/etc.
  const row =
    input.kind === "asset"
      ? {
          user_id: user.id,
          kind: "asset" as const,
          cadence: input.cadence,
          area: input.area ?? null,
          title: input.title,
          term_days: input.termDays,
          term_started_on: today,
          // jsonb column — cast mirrors the runner's metadata insert precedent.
          recurrence_rule: (input.recurrence
            ? buildRecurrenceRule(input.recurrence, today)
            : null) as never,
        }
      : {
          user_id: user.id,
          kind: "liability" as const,
          cadence: null,
          area: input.area ?? null,
          title: input.title,
        };

  const { data: created, error: insError } = await supabase
    .from("habits")
    .insert(row)
    .select("id, kind, cadence, area, title, term_days, status")
    .single();
  if (insError || !created) {
    console.error("habit create: insert failed", insError?.code);
    Sentry.captureException(new Error("habit_create_insert_failed"), {
      tags: { area: "habits", kind: "insert_failed" },
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, habit: created }, { status: 201 });
}

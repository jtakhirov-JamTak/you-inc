// Habit creation — build the roster (the balance-sheet positions). One habit per
// call; the roster's FIXED shape (1 morning + 1 evening + 1 mission asset + 1 vice)
// is enforced server-side against the caller's live, active roster.
//
// Handler order: origin → auth → rate-limit → validate → gate(roster) → insert.
//
// Notes:
//  - The owner is the session user; user_id is never taken from the body, and
//    RLS re-checks on insert.
//  - term_started_on is stamped from the user's timezone (user_settings),
//    consistent with how settlement buckets dates.
//  - The roster cap is both an app-level check AND a DB partial unique index
//    (0021 assets / 0023 vice) so a raced create surfaces a 409, not a 500.
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getAuthUser, createClient } from "@/lib/supabase/server";
import {
  createHabitSchema,
  updateHabitSchema,
  removeHabitSchema,
} from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { checkOrigin } from "@/lib/check-origin";
import { getUserToday } from "@/lib/user-today";
import { validateRosterAddition, type RosterSlot } from "@/lib/habits/roster";

export const runtime = "nodejs";

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

  // Today in the user's timezone — for term_started_on.
  const today = await getUserToday(supabase, user.id);

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
    // 23505 = a roster backstop fired (0021 one-active-asset-per-cadence, or 0023
    // one-active-vice) when a concurrent create raced the app-level gate. Surface
    // the same 409 the gate uses.
    if (insError?.code === "23505") {
      const msg =
        proposed.kind === "asset"
          ? `You already have a ${proposed.cadence} habit. Each cadence holds one.`
          : "You already have a vice. You can track one to pay down.";
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    console.error("habit create: insert failed", insError?.code);
    Sentry.captureException(new Error("habit_create_insert_failed"), {
      tags: { area: "habits", kind: "insert_failed" },
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, habit: created }, { status: 201 });
}

// Edit an existing habit's DETAILS (title / area / review term).
// kind + cadence are immutable — the roster's fixed slots stay intact. Editing a
// habit's definition never touches habit_logs, so the 0011 settled-week lock (on
// habit_logs) doesn't apply. Handler order: origin → auth → rate-limit → validate →
// fetch (ownership + active) → cross-validate against the habit's kind → update.
export async function PATCH(req: Request) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const {
    data: { user },
    error: authError,
  } = await getAuthUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await rateLimit(`habits:update:${user.id}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = updateHabitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const input = parsed.data;

  const supabase = await createClient();

  // Fetch the target habit. Check .error BEFORE acting; only an ACTIVE habit the
  // caller owns is editable (RLS also scopes the read).
  const { data: habit, error: habitError } = await supabase
    .from("habits")
    .select("id, kind, status")
    .eq("id", input.habitId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (habitError) {
    console.error("habit update: lookup failed", habitError.code);
    Sentry.captureException(new Error("habit_update_lookup_failed"), {
      tags: { area: "habits", kind: "update_lookup_failed" },
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
  if (!habit || habit.status !== "active") {
    return NextResponse.json({ error: "Habit not found" }, { status: 404 });
  }

  // Cross-field validity against the (immutable) kind: a review term only to an asset.
  if (input.termDays !== undefined && habit.kind !== "asset") {
    return NextResponse.json(
      { error: "Only an asset has a review term." },
      { status: 400 },
    );
  }

  // Apply only the provided fields. `area: null` clears it; omitted = unchanged.
  const update: {
    title?: string;
    area?: string | null;
    term_days?: number;
    updated_at?: string;
  } = {};
  if (input.title !== undefined) update.title = input.title;
  if (input.area !== undefined) update.area = input.area;
  if (input.termDays !== undefined) update.term_days = input.termDays;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true }, { status: 200 }); // nothing to change
  }
  update.updated_at = new Date().toISOString();

  const { error: updErr } = await supabase
    .from("habits")
    .update(update)
    .eq("id", input.habitId)
    .eq("user_id", user.id);
  if (updErr) {
    console.error("habit update: update failed", updErr.code);
    Sentry.captureException(new Error("habit_update_failed"), {
      tags: { area: "habits", kind: "update_failed" },
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

// Archive a habit (status → 'retired'). Stops scoring and frees the roster slot
// (rosterStatus, the price engine, and Board insights all count only 'active'),
// while keeping its check-in history — NOT a hard delete (which would cascade-erase
// habit_logs and desync the ledger). Idempotent: re-archiving is a harmless no-op.
export async function DELETE(req: Request) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const {
    data: { user },
    error: authError,
  } = await getAuthUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await rateLimit(`habits:remove:${user.id}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = removeHabitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { habitId } = parsed.data;

  const supabase = await createClient();
  const { error: updErr } = await supabase
    .from("habits")
    .update({ status: "retired", updated_at: new Date().toISOString() })
    .eq("id", habitId)
    .eq("user_id", user.id);
  if (updErr) {
    console.error("habit remove: archive failed", updErr.code);
    Sentry.captureException(new Error("habit_remove_failed"), {
      tags: { area: "habits", kind: "remove_failed" },
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

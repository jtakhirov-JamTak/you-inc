// Mission habit — create (or replace) the per-day Mission asset from the Mission
// tab. The Mission habit is a `cadence: 'mission'` asset with a review term; it's
// the only place this asset is authored. Creating it links the new habit onto
// identity_profile.mission_habit_id so the Mission tab can show it.
//
// Handler order: origin → auth → rate-limit → validate → gate(roster) → replace
// → insert → link.
//
// Notes:
//  - The owner is the session user; user_id is never taken from the body.
//  - Replacing retires (status 'replaced') the existing active mission asset, then
//    inserts a fresh one — so the per-cadence roster cap is never tripped.
//  - The link upsert is best-effort: the habit exists either way, so a link failure
//    is logged but still returns success.
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getAuthUser, createClient } from "@/lib/supabase/server";
import { createMissionHabitSchema } from "@/lib/validation";
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
  const rl = await rateLimit(`identity:mission-habit:${user.id}`, {
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
  const parsed = createMissionHabitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const input = parsed.data;

  const supabase = await createClient();

  // 5. Read the caller's ACTIVE roster. Check .error BEFORE deciding — a failed
  //    read must not look like an empty roster (which would wave the addition
  //    through against a hidden filled slot).
  const { data: existing, error: rosterError } = await supabase
    .from("habits")
    .select("id, kind, cadence")
    .eq("user_id", user.id)
    .eq("status", "active");
  if (rosterError) {
    console.error("mission habit: roster read failed", rosterError.code);
    Sentry.captureException(new Error("mission_habit_roster_read_failed"), {
      tags: { area: "identity", kind: "roster_read_failed" },
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  // Gate against the roster EXCLUDING any existing mission asset — re-creating
  // (replace) must not trip slot_taken on the slot we're about to free.
  const rows = existing ?? [];
  const existingMission = rows.find(
    (h) => h.kind === "asset" && h.cadence === "mission",
  );
  const remaining: RosterSlot[] = rows
    .filter((h) => h.id !== existingMission?.id)
    .map((h) => ({ kind: h.kind, cadence: h.cadence } as RosterSlot));
  const rosterErr = validateRosterAddition(remaining, {
    kind: "asset",
    cadence: "mission",
  });
  if (rosterErr) {
    return NextResponse.json({ error: rosterErr.message }, { status: 409 });
  }

  // 6. Replace — retire the existing active mission asset so the per-cadence cap
  //    isn't tripped by the insert below.
  if (existingMission) {
    const { error: replaceErr } = await supabase
      .from("habits")
      .update({ status: "replaced", archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", existingMission.id)
      .eq("user_id", user.id);
    if (replaceErr) {
      console.error("mission habit: replace failed", replaceErr.code);
      Sentry.captureException(new Error("mission_habit_replace_failed"), {
        tags: { area: "identity", kind: "replace_failed" },
      });
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
  }

  // Today in the user's timezone — for term_started_on.
  const today = await getUserToday(supabase, user.id);

  // 7. Insert. user_id from the session; defaults fill created_at/status/etc.
  const { data: created, error: insError } = await supabase
    .from("habits")
    .insert({
      user_id: user.id,
      kind: "asset" as const,
      cadence: "mission" as const,
      area: input.area,
      title: input.title,
      term_days: input.termDays,
      term_started_on: today,
    })
    .select("id, title, area, term_days")
    .single();
  if (insError || !created) {
    // 23505 = the 0021 one-active-asset-per-cadence backstop fired (a concurrent
    // create raced the app-level gate). Surface a 409.
    if (insError?.code === "23505") {
      return NextResponse.json(
        { error: "You already have a Mission habit." },
        { status: 409 },
      );
    }
    console.error("mission habit: insert failed", insError?.code);
    Sentry.captureException(new Error("mission_habit_insert_failed"), {
      tags: { area: "identity", kind: "insert_failed" },
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  // 8. Link onto identity_profile (upsert — the row may not exist yet).
  //    Best-effort: the habit exists, so a link failure is logged but not fatal.
  const { error: linkErr } = await supabase
    .from("identity_profile")
    .upsert(
      {
        user_id: user.id,
        mission_habit_id: created.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (linkErr) {
    console.error("mission habit: link failed", linkErr.code);
    Sentry.captureException(new Error("mission_habit_link_failed"), {
      tags: { area: "identity", kind: "link_failed" },
    });
  }

  return NextResponse.json({ ok: true, habit: created }, { status: 201 });
}

// Guided one-year-goal flow — the single end-of-flow commit (the 4-step prompt:
// Domain → Future Scene → Weekly Habit → Obstacle). This does TWO things the
// plain quick-edit (PUT /api/year-goals) does not:
//   1. Saves the goal with all its narrative fields + an auto-computed due date
//      (today + 1 year, in the user's timezone). The goal is flow-owned: it sets
//      target_date and weekly_habit_id, which the quick-edit PUT never touches.
//   2. Creates the WEEKLY HABIT from the chosen proof behavior + weekday schedule,
//      replacing any existing active weekly (status → 'replaced') first — the same
//      semantics as the Systems "replace" action.
//
// Handler order: origin → auth → rate-limit → validate → save goal → replace+create
// weekly habit → link the habit back to the goal.
//
// Owner is the session user (never the body); RLS re-checks every write. Creating
// a habit definition never touches habit_logs, so the 0011 settled-week lock
// doesn't apply here.
//
// The replace→insert sequence is not transactional, but the 0021 partial unique
// index (one active asset per cadence) is the real backstop: a concurrent/double
// submit's second insert fails with 23505, which we map to a 409 rather than
// silently creating a second active weekly. A failure between replace and insert
// is self-healing — the retry reads a roster with no active weekly and inserts
// cleanly.
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getAuthUser, createClient } from "@/lib/supabase/server";
import { createGoalFlowSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { checkOrigin } from "@/lib/check-origin";
import { addYears } from "@/lib/price/dates";
import { getUserToday } from "@/lib/user-today";
import { upsertActiveYearGoal } from "@/lib/year-goals/save";
import { validateRosterAddition, type RosterSlot } from "@/lib/habits/roster";

export const runtime = "nodejs";

function fail(kind: string, code?: string) {
  console.error("year goal flow failed", kind, code);
  Sentry.captureException(new Error("year_goal_flow_failed"), {
    tags: { area: "year_goals", kind },
  });
  return NextResponse.json({ error: "Server error" }, { status: 500 });
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
  const rl = await rateLimit(`year-goal:flow:${user.id}`, {
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
  const parsed = createGoalFlowSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const input = parsed.data;
  const orNull = (s?: string) => (s && s.trim() ? s.trim() : null);

  const supabase = await createClient();

  // Today in the user's timezone — for the +1yr due date and the habit's
  // term_started_on / recurrence anchor (consistent with settlement bucketing).
  const today = await getUserToday(supabase, user.id);
  const targetDate = addYears(today, 1);

  // ── 5. Save the goal (single-active model, shared with the quick-edit PUT) ───
  const goalResult = await upsertActiveYearGoal(supabase, user.id, {
    area: input.area,
    title: input.title,
    target_date: targetDate,
    weekly_behavior: input.weeklyBehavior.trim(),
    identity_statement: orNull(input.identityStatement),
    observable_proof: orNull(input.observableProof),
    success_metric: orNull(input.successMetric),
    obstacle: orNull(input.obstacle),
    if_then_1_trigger: orNull(input.ifThen1Trigger),
    if_then_1_action: orNull(input.ifThen1Action),
    if_then_2_trigger: orNull(input.ifThen2Trigger),
    if_then_2_action: orNull(input.ifThen2Action),
  });
  if (!goalResult.ok) return fail(`goal_${goalResult.stage}`, goalResult.code);
  const goalId = goalResult.goalId;

  // ── 6. Replace + create the weekly habit ────────────────────────────────────
  // Read the caller's ACTIVE habits. Check .error BEFORE acting — a failed read
  // must not look like an empty roster (and must not let us skip the replace).
  const { data: activeHabits, error: rosterErr } = await supabase
    .from("habits")
    .select("id, kind, cadence")
    .eq("user_id", user.id)
    .eq("status", "active");
  if (rosterErr) return fail("roster_read", rosterErr.code);

  // Defensive roster check BEFORE the destructive replace: ignore the existing
  // weekly (it's about to be freed) and confirm a weekly can be added. With a
  // clean roster this always passes; it only fires on a data anomaly (≥2 active
  // weeklies), and running it first means we don't partial-write on that path.
  const existingWeekly = (activeHabits ?? []).find(
    (h) => h.kind === "asset" && h.cadence === "weekly",
  );
  const remaining: RosterSlot[] = (activeHabits ?? [])
    .filter((h) => h.id !== existingWeekly?.id)
    .map((h) => ({
      kind: h.kind as "asset" | "liability",
      cadence: (h.cadence as RosterSlot["cadence"]) ?? null,
    }));
  const rosterAddErr = validateRosterAddition(remaining, {
    kind: "asset",
    cadence: "weekly",
  });
  if (rosterAddErr) {
    return NextResponse.json({ error: rosterAddErr.message }, { status: 409 });
  }

  // Free the weekly slot: any existing active weekly asset → 'replaced' (history
  // preserved; the price engine / insights count only 'active').
  if (existingWeekly) {
    const { error: replaceErr } = await supabase
      .from("habits")
      .update({ status: "replaced", updated_at: new Date().toISOString() })
      .eq("id", existingWeekly.id)
      .eq("user_id", user.id);
    if (replaceErr) return fail("habit_replace", replaceErr.code);
  }

  const days = [...new Set(input.days)].sort((a, b) => a - b);
  const { data: newHabit, error: habitInsErr } = await supabase
    .from("habits")
    .insert({
      user_id: user.id,
      kind: "asset",
      cadence: "weekly",
      area: input.area,
      title: input.weeklyBehavior.trim(),
      term_days: input.termDays,
      term_started_on: today,
      recurrence_rule: { type: "weekdays", days } as never,
    })
    .select("id")
    .single();
  if (habitInsErr || !newHabit) {
    // 23505 = the 0021 one-active-asset-per-cadence backstop fired: a concurrent
    // submit already created the active weekly. Surface a 409, not a 500.
    if (habitInsErr?.code === "23505") {
      return NextResponse.json(
        { error: "You already have a weekly habit. Each cadence holds one." },
        { status: 409 },
      );
    }
    return fail("habit_insert", habitInsErr?.code);
  }

  // ── 7. Link the habit back to the goal (best-effort; non-fatal) ──────────────
  // The goal + habit already exist and are correct; a failed link is cosmetic and
  // must NOT trigger a retry (which would replace the just-created weekly again).
  const { error: linkErr } = await supabase
    .from("year_goals")
    .update({ weekly_habit_id: newHabit.id, updated_at: new Date().toISOString() })
    .eq("id", goalId)
    .eq("user_id", user.id);
  if (linkErr) {
    console.error("year goal flow: habit link failed", linkErr.code);
    Sentry.captureException(new Error("year_goal_flow_link_failed"), {
      tags: { area: "year_goals", kind: "habit_link" },
    });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

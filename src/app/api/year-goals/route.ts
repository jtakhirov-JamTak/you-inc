// Year goal quick-edit (spec §Year goals). The user keeps a single active one-year
// goal, shown on Strategy. This upserts that one goal's TEXT fields: update the
// existing active row if present, else insert a new active one. Editable content
// (not a log).
//
// Scope vs the guided flow (POST /api/year-goals/flow): quick-edit edits the goal's
// text only. It deliberately does NOT write `target_date` or `weekly_habit_id`
// (flow-owned), and never creates/replaces the weekly habit — the user manages
// that on Systems.
//
// Handler order: origin → auth → rate-limit → validate → write.
//
// Owner is the session user (never the body); RLS re-checks every write.
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getAuthUser, createClient } from "@/lib/supabase/server";
import { saveYearGoalSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { checkOrigin } from "@/lib/check-origin";
import { upsertActiveYearGoal } from "@/lib/year-goals/save";

export const runtime = "nodejs";

function fail(area: string) {
  console.error("year goal save failed", area);
  Sentry.captureException(new Error("year_goal_save_failed"), {
    tags: { area: "year_goals", kind: area },
  });
  return NextResponse.json({ error: "Server error" }, { status: 500 });
}

export async function PUT(req: Request) {
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
  const rl = await rateLimit(`year-goal:save:${user.id}`, {
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
  const parsed = saveYearGoalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const {
    title,
    area,
    description,
    weeklyBehavior,
    identityStatement,
    observableProof,
    successMetric,
    obstacle,
    ifThen1Trigger,
    ifThen1Action,
    ifThen2Trigger,
    ifThen2Action,
  } = parsed.data;

  // Empty / whitespace-only narrative fields are stored as null (unset).
  const orNull = (s?: string) => (s && s.trim() ? s.trim() : null);

  const supabase = await createClient();
  // Quick-edit writes the goal's text fields ONLY. `target_date` and
  // `weekly_habit_id` are flow-owned and intentionally omitted here, so editing
  // the goal text never overwrites the auto-computed due date or the habit link.
  const result = await upsertActiveYearGoal(supabase, user.id, {
    area,
    title,
    description: orNull(description),
    weekly_behavior: orNull(weeklyBehavior),
    identity_statement: orNull(identityStatement),
    observable_proof: orNull(observableProof),
    success_metric: orNull(successMetric),
    obstacle: orNull(obstacle),
    if_then_1_trigger: orNull(ifThen1Trigger),
    if_then_1_action: orNull(ifThen1Action),
    if_then_2_trigger: orNull(ifThen2Trigger),
    if_then_2_action: orNull(ifThen2Action),
  });
  if (!result.ok) return fail(result.stage);

  return NextResponse.json({ ok: true });
}

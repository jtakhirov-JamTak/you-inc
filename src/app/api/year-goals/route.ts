// Year goal save (spec §Year goals). The user keeps a single active one-year
// goal, shown on Strategy. This upserts that one goal: update the existing active
// row if present, else insert a new active one. Editable content (not a log).
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
  const { title, area, description, targetDate } = parsed.data;

  const supabase = await createClient();
  const now = new Date().toISOString();
  const fields = {
    area,
    title,
    description: description?.trim() || null,
    target_date: targetDate?.trim() || null,
    updated_at: now,
  };

  // Find the user's existing active goal (single-goal model). Tolerate the
  // legitimately-absent case (no rows) — only a real read error is fatal.
  const { data: existing, error: readError } = await supabase
    .from("year_goals")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readError) return fail("read");

  // Single-goal model: keep exactly one active goal. Archive any OTHER active rows
  // first so switching the goal's area can never collide with the legacy
  // one-active-per-area unique index (0005), and stray active rows can't pile up.
  let archiveQuery = supabase
    .from("year_goals")
    .update({ status: "archived", updated_at: now })
    .eq("user_id", user.id)
    .eq("status", "active");
  if (existing) archiveQuery = archiveQuery.neq("id", existing.id);
  const { error: archiveError } = await archiveQuery;
  if (archiveError) return fail("archive");

  if (existing) {
    const { error: updateError } = await supabase
      .from("year_goals")
      .update(fields)
      .eq("id", existing.id)
      .eq("user_id", user.id);
    if (updateError) return fail("update");
  } else {
    const { error: insertError } = await supabase
      .from("year_goals")
      .insert({ user_id: user.id, status: "active", ...fields });
    if (insertError) return fail("insert");
  }

  return NextResponse.json({ ok: true });
}

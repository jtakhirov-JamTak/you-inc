// Habit term-review actions (handoff §2): renew · replace · graduate. Applied to an
// ACTIVE asset at/near its term end. The "near term end" gating is a UI affordance;
// the server only enforces that the target is the caller's own active asset.
//
//  - renew    → restart the same habit on a fresh term (term_started_on = today).
//  - replace  → free the roster slot for a different habit (status → 'replaced').
//  - graduate → snapshot the habit to the holdings shelf, then stop it scoring
//               (status → 'graduated'). A deliberate human judgment, never automatic.
//
// Handler order: origin → auth → rate-limit → validate → fetch (own active asset) → act.
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getAuthUser, createClient } from "@/lib/supabase/server";
import { reviewHabitSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { checkOrigin } from "@/lib/check-origin";
import { localDateInTz } from "@/lib/price/dates";

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
  const rl = await rateLimit(`habits:review:${user.id}`, { limit: 30, windowMs: 60_000 });
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
  const parsed = reviewHabitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { habitId, action, summary } = parsed.data;

  const supabase = await createClient();

  // 5. Fetch the target — only the caller's OWN ACTIVE ASSET is reviewable. Check
  //    .error before acting (a failed read must not look like "not found").
  const { data: habit, error: habitError } = await supabase
    .from("habits")
    .select("id, kind, status, title, area")
    .eq("id", habitId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (habitError) {
    console.error("habit review: lookup failed", habitError.code);
    Sentry.captureException(new Error("habit_review_lookup_failed"), {
      tags: { area: "habits", kind: "review_lookup_failed" },
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
  if (!habit || habit.status !== "active" || habit.kind !== "asset") {
    return NextResponse.json({ error: "Habit not found" }, { status: 404 });
  }

  const nowIso = new Date().toISOString();

  // 6. Act.
  if (action === "renew") {
    // Today in the user's timezone — the fresh term's start (mirrors create).
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
    // Only term_started_on moves. We deliberately leave the derived-cache columns
    // current_streak_days / clean_since untouched — nothing reads them for scoring
    // (the engine derives streak/clean from habit_logs), so they're unmaintained.
    const { error } = await supabase
      .from("habits")
      .update({ term_started_on: today, updated_at: nowIso })
      .eq("id", habitId)
      .eq("user_id", user.id);
    if (error) return failure("review_renew_failed", error.code);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (action === "replace") {
    const { error } = await supabase
      .from("habits")
      .update({ status: "replaced", updated_at: nowIso })
      .eq("id", habitId)
      .eq("user_id", user.id);
    if (error) return failure("review_replace_failed", error.code);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // graduate — snapshot to the shelf FIRST, then stop scoring. Ordering matters: if
  // the snapshot insert fails we must NOT graduate (the habit would vanish with no
  // shelf record). The shelf row is a frozen copy so it survives later edits/deletes.
  const { error: shelfErr } = await supabase.from("graduated_habits").insert({
    user_id: user.id,
    source_habit_id: habit.id,
    title: habit.title,
    area: habit.area,
    summary: summary ?? null,
  });
  // 23505 = unique_violation on the (user, source_habit) partial index (0017): a
  // retried/concurrent graduate already wrote the shelf row. Idempotent — fall
  // through to ensure the status is flipped, rather than 500-ing on the duplicate.
  if (shelfErr && shelfErr.code !== "23505") {
    return failure("review_graduate_snapshot_failed", shelfErr.code);
  }

  const { error: statusErr } = await supabase
    .from("habits")
    .update({ status: "graduated", updated_at: nowIso })
    .eq("id", habitId)
    .eq("user_id", user.id);
  if (statusErr) return failure("review_graduate_status_failed", statusErr.code);

  return NextResponse.json({ ok: true }, { status: 200 });
}

// Shared 500 path — log a code (never user content) + a Sentry breadcrumb.
function failure(kind: string, code?: string) {
  console.error(`habit review: ${kind}`, code);
  Sentry.captureException(new Error(`habit_${kind}`), {
    tags: { area: "habits", kind },
  });
  return NextResponse.json({ error: "Server error" }, { status: 500 });
}

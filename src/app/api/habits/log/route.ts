// Habit logging — append a raw per-day completion (asset) or relapse
// (liability) to habit_logs, the Layer-1 source of truth the price engine later
// derives from (logs → score_events → price; never the reverse).
//
// Handler order: origin → auth → rate-limit → validate → gate → idempotent write.
//
// Key invariants:
//  - `status` is server-derived from the habit's kind (asset→done, liability→
//    relapse). The client never picks it.
//  - Idempotency rides the natural key (user_id, habit_id, local_date): a repeat
//    tap is a no-op, not a duplicate. `source_session_id` is stored as the
//    per-submission token (Playbook §16.1).
//  - We only ever write the CALLER's own rows (user_id from the session, never
//    the body) and RLS enforces it again.
//
// DEFERRED (M3 guardrail, tracked in memory project_you_inc_scoring_overrides):
// a settled-week WRITE LOCK. Editing logs for an already-settled week silently
// diverges raw from the booked, idempotent ledger. Until that lock lands, treat
// a settled week's logs as frozen by convention.
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { habitLogSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { checkOrigin } from "@/lib/check-origin";
import { localDateInTz } from "@/lib/price/dates";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // 1. Origin — same-origin write; reject cross-site CSRF.
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 2. Auth — the row owner is the session user, never a client-supplied id.
  const {
    data: { user },
    error: authError,
  } = await getAuthUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 3. Rate limit — generous; logging is a frequent tap, but cap abuse/loops.
  const rl = await rateLimit(`habits:log:${user.id}`, {
    limit: 120,
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
  const parsed = habitLogSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { habitId, localDate, occurredTz, sourceSessionId, action, note } =
    parsed.data;

  // The IANA zone must be real (Intl throws on a bogus name). We use it to find
  // the user's local "today" and reject a future-dated log — you can't have done
  // something that hasn't happened yet. Past dates are allowed (backfill).
  let userToday: string;
  try {
    userToday = localDateInTz(new Date(), occurredTz);
  } catch {
    return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
  }
  if (localDate > userToday) {
    return NextResponse.json(
      { error: "Cannot log a future date" },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  // 5. Gate — the habit must exist, belong to the caller, and be active. RLS
  //    already scopes the read to the user; the explicit user_id filter is belt
  //    and suspenders. Check .error BEFORE acting on data (a failed read must
  //    never be mistaken for "no such habit").
  const { data: habit, error: habitError } = await supabase
    .from("habits")
    .select("id, kind, status")
    .eq("id", habitId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (habitError) {
    console.error("habit lookup failed", habitError.code);
    Sentry.captureException(new Error("habit_log_lookup_failed"), {
      tags: { area: "habits", kind: "lookup_failed" },
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
  if (!habit) {
    return NextResponse.json({ error: "Habit not found" }, { status: 404 });
  }
  if (habit.status !== "active") {
    return NextResponse.json(
      { error: "Habit is not active" },
      { status: 409 },
    );
  }

  // Server derives the log status from the habit kind — never from the client.
  const status = habit.kind === "asset" ? "done" : "relapse";

  // 6a. Undo — remove that day's row (the spec's "second tap is an undo").
  if (action === "undo") {
    const { data: deleted, error: delError } = await supabase
      .from("habit_logs")
      .delete()
      .eq("user_id", user.id)
      .eq("habit_id", habitId)
      .eq("local_date", localDate)
      .select("log_id");
    if (delError) {
      console.error("habit log undo failed", delError.code);
      Sentry.captureException(new Error("habit_log_undo_failed"), {
        tags: { area: "habits", kind: "undo_failed" },
      });
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, undone: (deleted?.length ?? 0) > 0 });
  }

  // 6b. Log — idempotent insert on the natural key. A repeat submission (retry,
  //     double-tap) conflicts and is silently ignored; the original row — and
  //     its immutable recorded_at — is preserved.
  const { data: inserted, error: insError } = await supabase
    .from("habit_logs")
    .upsert(
      {
        user_id: user.id,
        habit_id: habitId,
        local_date: localDate,
        occurred_tz: occurredTz,
        status,
        source_session_id: sourceSessionId,
        note: note ?? null,
      },
      { onConflict: "user_id,habit_id,local_date", ignoreDuplicates: true },
    )
    .select("log_id");
  if (insError) {
    console.error("habit log insert failed", insError.code);
    Sentry.captureException(new Error("habit_log_insert_failed"), {
      tags: { area: "habits", kind: "insert_failed" },
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  // inserted is empty on an idempotent no-op (row already existed for the day).
  const created = (inserted?.length ?? 0) > 0;
  return NextResponse.json({ ok: true, status, created });
}

// Generate (or return the cached) AI performance analysis for one board meeting.
// Handler order: origin → auth → rate-limit → validate → act. This is the app's
// only AI-spending path, so it is guarded twice: a hard rate limit AND an
// idempotent cache — once a meeting's analysis exists for the current prompt
// version, we return it without calling the model. The facts are derived
// deterministically from the user's own logs (insights.ts); the AI only phrases
// them (analyst.ts) and can never invent a number.
//
// Uses the RLS client throughout: every read (logs, sprints, deltas) and the
// analysis write are scoped to the authenticated owner by policy. No service role.
import { NextResponse } from "next/server";
import { getAuthUser, createClient } from "@/lib/supabase/server";
import { boardAnalysisSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { checkOrigin } from "@/lib/check-origin";
import { addDays, localDateInTz, compareLocalDate, type LocalDate } from "@/lib/price/dates";
import {
  computeInsightFacts,
  type InsightInput,
  type InsightInputHabit,
  type InsightInputLog,
} from "@/lib/board/insights";
import { generateAnalysis } from "@/lib/board/analyst";
import { PROMPT_VERSION } from "@/lib/board/analyst-core";

export const runtime = "nodejs";

const WINDOW_DAYS = 42; // 6 rolling weeks (inclusive)

export async function POST(req: Request) {
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

  // Tight limit: each generation is a model call. The cache below means the normal
  // path (re-viewing) never reaches the model anyway.
  const rl = await rateLimit(`board:analysis:${user.id}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = boardAnalysisSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { meetingId } = parsed.data;

  const supabase = await createClient();

  // ── The meeting + any cached analysis (RLS scopes to owner). ────────────────
  const { data: meeting, error: meetingErr } = await supabase
    .from("board_meetings")
    .select("id, week_index, settled_at, analysis_text, analysis_state, analysis_prompt_version, analysis_facts, analysis_generated_at")
    .eq("id", meetingId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (meetingErr) {
    console.error("board analysis: meeting read failed", meetingErr.code);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
  if (!meeting) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Cache hit: same prompt version already generated → no model call (cost gate).
  if (meeting.analysis_generated_at && meeting.analysis_prompt_version === PROMPT_VERSION) {
    const facts = meeting.analysis_facts as { topPatterns?: unknown } | null;
    return NextResponse.json(
      {
        state: meeting.analysis_state,
        text: meeting.analysis_text,
        patterns: facts?.topPatterns ?? [],
        cached: true,
      },
      { status: 200 },
    );
  }

  // ── Gather the rolling window from the user's own data. ─────────────────────
  const settingsRes = await supabase
    .from("user_settings")
    .select("timezone")
    .eq("user_id", user.id)
    .maybeSingle();
  if (settingsRes.error) {
    console.error("board analysis: settings read failed", settingsRes.error.code);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
  // A user_settings row is created at signup, so this is effectively always set; the
  // UTC fallback only guards a not-fully-onboarded account (which has no logs anyway).
  const tz = settingsRes.data?.timezone ?? "UTC";
  const endDate: LocalDate = meeting.settled_at
    ? localDateInTz(new Date(meeting.settled_at), tz)
    : localDateInTz(new Date(), tz);
  const startDate: LocalDate = addDays(endDate, -(WINDOW_DAYS - 1));

  const [habitsRes, logsRes, sprintsRes, deltasRes] = await Promise.all([
    // Only ACTIVE habits are scored — a graduated/retired habit stops being logged,
    // so counting its absent days as skips would fabricate a pattern (mirrors the
    // price engine's status filter in weeks.ts).
    supabase
      .from("habits")
      .select("id, title, kind, cadence, area, created_at, status")
      .eq("user_id", user.id)
      .eq("status", "active"),
    supabase
      .from("habit_logs")
      .select("habit_id, status, local_date")
      .eq("user_id", user.id)
      .gte("local_date", startDate)
      .lte("local_date", endDate),
    supabase
      .from("sprints")
      .select("id, closed_at")
      .eq("user_id", user.id)
      .eq("status", "closed"),
    // The last 6 settled weeks for the trend (bounded by week_index — uses
    // board_meetings_user_week_idx, never an unbounded all-weeks scan).
    supabase
      .from("board_meetings")
      .select("week_index, week_delta_cents")
      .eq("user_id", user.id)
      .gte("week_index", meeting.week_index - 5)
      .lte("week_index", meeting.week_index),
  ]);
  // Reads must succeed before we compute — a transient error must not be read as
  // "no data" and cached as an insufficient/empty analysis.
  if (habitsRes.error || logsRes.error || sprintsRes.error || deltasRes.error) {
    console.error(
      "board analysis: window read failed",
      habitsRes.error?.code ?? logsRes.error?.code ?? sprintsRes.error?.code ?? deltasRes.error?.code,
    );
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  const habits: InsightInputHabit[] = (habitsRes.data ?? []).map((h) => ({
    id: h.id,
    title: h.title,
    kind: h.kind === "liability" ? "liability" : "asset",
    cadence: h.cadence,
    area: h.area,
    status: h.status,
    startLocal: localDateInTz(new Date(h.created_at), tz),
  }));
  // Drop any unrecognized status rather than coercing it to "done" — today the DB
  // CHECK only allows done/relapse, but this stays correct if a status is ever added.
  const logs: InsightInputLog[] = (logsRes.data ?? [])
    .filter((l) => l.status === "done" || l.status === "relapse")
    .map((l) => ({
      habitId: l.habit_id,
      status: l.status === "relapse" ? ("relapse" as const) : ("done" as const),
      localDate: l.local_date,
    }));

  // Closed sprints whose close date falls in the window + their tasks.
  const closedInWindow = (sprintsRes.data ?? []).filter((s) => {
    if (!s.closed_at) return false;
    const d = localDateInTz(new Date(s.closed_at), tz);
    return compareLocalDate(d, startDate) >= 0 && compareLocalDate(d, endDate) <= 0;
  });
  let closedSprintTasks: { done: boolean }[] = [];
  if (closedInWindow.length > 0) {
    const taskRes = await supabase
      .from("sprint_tasks")
      .select("done")
      .eq("user_id", user.id)
      .in(
        "sprint_id",
        closedInWindow.map((s) => s.id),
      );
    if (taskRes.error) {
      console.error("board analysis: sprint tasks read failed", taskRes.error.code);
      return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
    closedSprintTasks = (taskRes.data ?? []).map((t) => ({ done: !!t.done }));
  }

  // Already bounded to the last 6 settled weeks by the week_index range above.
  const weeklyDeltas = (deltasRes.data ?? []).map((m) => ({
    weekIndex: m.week_index,
    deltaCents: m.week_delta_cents,
  }));

  const input: InsightInput = {
    window: { startDate, endDate },
    habits,
    logs,
    closedSprintTasks,
    closedSprintCount: closedInWindow.length,
    weeklyDeltas,
  };
  const facts = computeInsightFacts(input);

  // A settled meeting's window is frozen, so its facts are stable — a definitive
  // result (insufficient verdict or successful phrasing) is stamped and cached. An
  // AI failure is NOT stamped, so the next visit retries the phrasing instead of
  // freezing the week to the fallback over a transient blip.

  // ── Below threshold → store the verdict, no model call (prefer "not enough data"). ─
  if (facts.state === "insufficient") {
    await persist(supabase, meetingId, user.id, { facts, state: facts.state, stamp: true });
    return NextResponse.json(
      { state: facts.state, text: null, patterns: [], evidence: facts.evidence },
      { status: 200 },
    );
  }

  // ── Phrase the facts. On failure, keep the deterministic patterns as fallback. ─
  const generated = await generateAnalysis(facts);
  await persist(supabase, meetingId, user.id, {
    facts,
    state: facts.state,
    text: generated?.output ?? null,
    promptVersion: generated?.promptVersion,
    model: generated?.model,
    stamp: !!generated, // only cache a successful generation
  });

  return NextResponse.json(
    {
      state: facts.state,
      text: generated?.output ?? null,
      patterns: facts.topPatterns,
      generationFailed: !generated,
    },
    { status: 200 },
  );
}

// Cache the computed analysis on the meeting (RLS owner UPDATE). A failed write is
// non-fatal — the response already carries the result; it just regenerates next time.
async function persist(
  supabase: Awaited<ReturnType<typeof createClient>>,
  meetingId: string,
  userId: string,
  v: {
    facts: unknown;
    state: string;
    text?: unknown;
    promptVersion?: string;
    model?: string;
    /** Stamp analysis_generated_at → mark this result cached. Omit on AI failure so
     *  the next visit retries the phrasing rather than freezing the fallback. */
    stamp: boolean;
  },
): Promise<void> {
  const { error } = await supabase
    .from("board_meetings")
    .update({
      analysis_facts: v.facts as never,
      analysis_state: v.state,
      analysis_text: (v.text ?? null) as never,
      analysis_prompt_version: v.promptVersion ?? PROMPT_VERSION,
      analysis_model: v.model ?? null,
      analysis_generated_at: v.stamp ? new Date().toISOString() : null,
    })
    .eq("id", meetingId)
    .eq("user_id", userId);
  if (error) {
    console.error("board analysis: persist failed", error.code);
  }
}

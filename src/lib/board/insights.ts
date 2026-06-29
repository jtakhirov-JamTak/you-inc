// Board performance insights — PURE (no I/O, no AI). Turns a user's habit roster +
// raw logs + sprint follow-through + weekly deltas over a rolling window into a set
// of evidence-traced behavioral facts. This is the source of truth for every number
// the Board's analysis shows: the AI layer (analyst.ts) only PHRASES these facts and
// may never introduce a number of its own.
//
// Governed by docs/Evidence_Based_Insights_Architecture: prefer no insight over a
// weak one. Patterns are gated behind evidence thresholds (enough days, enough
// distinct days, a weekday seen more than once) and each carries a deterministic
// `statement` that doubles as the no-AI fallback. Closed taxonomy: `PatternKind`
// never grows at runtime.
//
// v0 simplification (deliberate): Pattern Observations are computed in-memory and
// the derived facts are stored as the evidence basis (recomputable from logs),
// rather than materialized as their own table. The dependency arrow stays one-way
// (logs → facts), so improving this logic just means re-deriving.

import { addDays, compareLocalDate, dayOfWeek, type LocalDate } from "@/lib/price/dates";

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

// ── Evidence thresholds (policy; the gating logic is the law) ─────────────────
const MIN_LOGS = 6; // total logged actions in the window
const MIN_DISTINCT_DAYS = 5; // actions can't all be from one stretch
// A habit needs ≥2 weeks of its OWN active history before we'll make a confident
// claim about it — otherwise a habit created a few days ago surfaces as an
// "established" pattern just because OTHER habits cleared the global evidence gate.
const MIN_HABIT_ACTIVE_DAYS = 14;
const MIN_MISSES_FOR_PATTERN = 2; // one miss isn't a pattern
const MIN_WEEKDAY_OCCURRENCES = 2; // can't call it a "Thursday thing" from one Thursday
const STRONG_MAX_MISS_RATE = 0.2; // ≤20% missed → a "strong" (positive) habit
const ESTABLISHED_DISTINCT_DAYS = 14; // emerging → established

export type InsightState = "insufficient" | "emerging" | "established";

// Closed taxonomy — the AI is never allowed to invent a kind, and downstream UI
// keys off these. New kinds require an explicit add/test/deploy.
export type PatternKind =
  | "habit_skip"
  | "vice_relapse"
  | "habit_strong"
  | "sprint_follow_through"
  | "trend";

export interface TopPattern {
  kind: PatternKind;
  direction: "positive" | "negative" | "neutral";
  /** Deterministic plain-English fact — the AI's grounding AND the no-AI fallback. */
  statement: string;
  /** The raw numbers behind the statement, for audit + the prompt. */
  facts: Record<string, number | string>;
}

export interface HabitPattern {
  habitId: string;
  title: string;
  kind: "asset" | "liability";
  cadence: string | null;
  area: string | null;
  scheduledDays: number;
  missedDays: number;
  missRate: number;
  worstWeekday: { weekday: number; name: string; missed: number } | null;
}

export interface InsightInputHabit {
  id: string;
  title: string;
  kind: "asset" | "liability";
  cadence: string | null;
  area: string | null;
  /** Only 'active' habits are scored — a graduated/retired habit stops being logged,
   *  so counting its absent days as "skips" would fabricate a pattern about a habit
   *  the user deliberately stopped (mirrors price/weeks.ts status filter). */
  status: string;
  startLocal: LocalDate;
}
export interface InsightInputLog {
  habitId: string;
  status: "done" | "relapse";
  localDate: LocalDate;
}
export interface InsightInput {
  window: { startDate: LocalDate; endDate: LocalDate };
  habits: InsightInputHabit[];
  logs: InsightInputLog[];
  /** Tasks of sprints CLOSED within the window. */
  closedSprintTasks: { done: boolean }[];
  closedSprintCount: number;
  /** Settled-week deltas within the window (board_meetings.week_delta_cents). */
  weeklyDeltas: { weekIndex: number; deltaCents: number }[];
}

export interface InsightFacts {
  window: { startDate: LocalDate; endDate: LocalDate; weeks: number };
  evidence: { totalLogs: number; distinctDays: number; activeHabits: number };
  state: InsightState;
  /** The selected, ranked facts to surface (≤3). Empty when insufficient. */
  topPatterns: TopPattern[];
}

const inWindow = (d: LocalDate, start: LocalDate, end: LocalDate) =>
  compareLocalDate(d, start) >= 0 && compareLocalDate(d, end) <= 0;

/** Every habit's miss/relapse profile over the window (assets: skipped scheduled
 *  days; vices: relapse days), with the worst weekday when one stands out. */
function buildHabitPatterns(input: InsightInput): HabitPattern[] {
  const { window, habits, logs } = input;
  return habits
    .filter((h) => h.status === "active" && compareLocalDate(h.startLocal, window.endDate) <= 0)
    .map((h) => {
      const activeStart =
        compareLocalDate(h.startLocal, window.startDate) > 0 ? h.startLocal : window.startDate;
      const mine = logs.filter((l) => l.habitId === h.id && inWindow(l.localDate, activeStart, window.endDate));

      // Every asset (morning/evening/mission) OR vice scores per-day: every active
      // day is scheduled. An asset day with no `done` log is a skip; a vice day with
      // no `done` ("paid/avoided") log
      // is a slip — the INFERRED absence, since vices are affirmative-only now and
      // never write a 'relapse' row (mirrors price/positions.ts inferredViceSlipDates).
      // Bucket the misses by weekday to find the soft spot.
      const doneSet = new Set(mine.filter((l) => l.status === "done").map((l) => l.localDate));
      const byWeekday = new Array(7).fill(0);
      let scheduled = 0;
      let missed = 0;
      for (let d = activeStart; compareLocalDate(d, window.endDate) <= 0; d = addDays(d, 1)) {
        scheduled++;
        if (!doneSet.has(d)) {
          missed++;
          byWeekday[dayOfWeek(d)]++;
        }
      }
      return {
        habitId: h.id,
        title: h.title,
        kind: h.kind,
        cadence: h.cadence,
        area: h.area,
        scheduledDays: scheduled,
        missedDays: missed,
        missRate: scheduled > 0 ? missed / scheduled : 0,
        worstWeekday: pickWorstWeekday(byWeekday),
      };
    });
}

function pickWorstWeekday(byWeekday: number[]): HabitPattern["worstWeekday"] {
  let best = -1;
  let bestCount = 0;
  for (let w = 0; w < 7; w++) {
    if (byWeekday[w] > bestCount) {
      bestCount = byWeekday[w];
      best = w;
    }
  }
  if (best < 0 || bestCount < MIN_WEEKDAY_OCCURRENCES) return null;
  return { weekday: best, name: WEEKDAY_NAMES[best], missed: bestCount };
}

/** Compute the evidence-gated, ranked facts for the window. */
export function computeInsightFacts(input: InsightInput): InsightFacts {
  const { window, logs, weeklyDeltas } = input;
  const winLogs = logs.filter((l) => inWindow(l.localDate, window.startDate, window.endDate));
  const distinctDays = new Set(winLogs.map((l) => l.localDate)).size;
  const activeHabits = input.habits.filter(
    (h) => h.status === "active" && compareLocalDate(h.startLocal, window.endDate) <= 0,
  ).length;
  const weeks = weeklyDeltas.length;

  const evidence = { totalLogs: winLogs.length, distinctDays, activeHabits };
  const baseWindow = { ...window, weeks };

  // Below threshold → no patterns at all (prefer "not enough data" over a guess).
  if (activeHabits === 0 || winLogs.length < MIN_LOGS || distinctDays < MIN_DISTINCT_DAYS) {
    return { window: baseWindow, evidence, state: "insufficient", topPatterns: [] };
  }
  const state: InsightState =
    distinctDays >= ESTABLISHED_DISTINCT_DAYS && weeks >= 4 ? "established" : "emerging";

  const patterns = buildHabitPatterns(input);

  // ── Candidate facts (closed taxonomy) ──────────────────────────────────────
  const skips: TopPattern[] = patterns
    .filter(
      (p) =>
        p.kind === "asset" &&
        p.scheduledDays >= MIN_HABIT_ACTIVE_DAYS &&
        p.missedDays >= MIN_MISSES_FOR_PATTERN &&
        p.worstWeekday !== null,
    )
    .sort((a, b) => b.missedDays - a.missedDays)
    .map((p) => ({
      kind: "habit_skip" as const,
      direction: "negative" as const,
      statement: `Skipped "${p.title}" on ${p.missedDays} of ${p.scheduledDays} scheduled days, most often on ${p.worstWeekday!.name}s (${p.worstWeekday!.missed} times).`,
      facts: {
        habit: p.title,
        missed: p.missedDays,
        scheduled: p.scheduledDays,
        worstWeekday: p.worstWeekday!.name,
        worstWeekdayCount: p.worstWeekday!.missed,
      },
    }));

  const relapses: TopPattern[] = patterns
    .filter(
      (p) =>
        p.kind === "liability" &&
        p.scheduledDays >= MIN_HABIT_ACTIVE_DAYS &&
        p.missedDays >= MIN_MISSES_FOR_PATTERN &&
        p.worstWeekday !== null,
    )
    .sort((a, b) => b.missedDays - a.missedDays)
    .map((p) => ({
      kind: "vice_relapse" as const,
      direction: "negative" as const,
      statement: `Relapsed on "${p.title}" ${p.missedDays} times, most often on ${p.worstWeekday!.name}s (${p.worstWeekday!.missed} times).`,
      facts: {
        habit: p.title,
        relapses: p.missedDays,
        worstWeekday: p.worstWeekday!.name,
        worstWeekdayCount: p.worstWeekday!.missed,
      },
    }));

  const strong: TopPattern[] = patterns
    .filter(
      (p) =>
        p.kind === "asset" &&
        p.scheduledDays >= MIN_HABIT_ACTIVE_DAYS &&
        p.missRate <= STRONG_MAX_MISS_RATE,
    )
    .sort((a, b) => a.missRate - b.missRate)
    .map((p) => {
      const done = p.scheduledDays - p.missedDays;
      return {
        kind: "habit_strong" as const,
        direction: "positive" as const,
        statement: `Held "${p.title}" on ${done} of ${p.scheduledDays} scheduled days (${Math.round((done / p.scheduledDays) * 100)}%).`,
        facts: { habit: p.title, done, scheduled: p.scheduledDays },
      };
    });

  const sprintFacts: TopPattern[] = [];
  if (input.closedSprintCount >= 1 && input.closedSprintTasks.length >= 3) {
    const total = input.closedSprintTasks.length;
    const done = input.closedSprintTasks.filter((t) => t.done).length;
    sprintFacts.push({
      kind: "sprint_follow_through",
      direction: done / total >= 0.6 ? "positive" : "negative",
      statement: `Completed ${done} of ${total} sprint tasks across ${input.closedSprintCount} closed sprint${input.closedSprintCount > 1 ? "s" : ""}.`,
      facts: { done, total, sprints: input.closedSprintCount },
    });
  }

  const trendFacts: TopPattern[] = [];
  if (weeklyDeltas.length >= 2) {
    const net = weeklyDeltas.reduce((s, w) => s + w.deltaCents, 0);
    trendFacts.push({
      kind: "trend",
      direction: net > 0 ? "positive" : net < 0 ? "negative" : "neutral",
      statement: `Net operating value moved ${net >= 0 ? "+" : "−"}$${Math.abs(Math.round(net / 100)).toLocaleString("en-US")} across ${weeklyDeltas.length} settled weeks.`,
      facts: { netCents: net, weeks: weeklyDeltas.length },
    });
  }

  // ── Selection: a balanced read — the sharpest problem, one bright spot, and the
  //    trajectory — so a user who is improving never sees only the old failure. ──
  const topPatterns: TopPattern[] = [];
  // Rank the negative to surface by TOTAL misses/relapses (the sharpest problem
  // overall), not by weekday concentration — a habit skipped 30× spread across the
  // week is a bigger problem than one skipped 8× all on Mondays.
  const negMagnitude = (p: TopPattern) => Number(p.facts.missed ?? p.facts.relapses ?? 0);
  const worstNegative = [...skips, ...relapses].sort((a, b) => negMagnitude(b) - negMagnitude(a))[0];
  if (worstNegative) topPatterns.push(worstNegative);
  if (strong[0]) topPatterns.push(strong[0]);
  if (sprintFacts[0] && topPatterns.length < 3) topPatterns.push(sprintFacts[0]);
  if (trendFacts[0] && topPatterns.length < 3) topPatterns.push(trendFacts[0]);

  return { window: baseWindow, evidence, state, topPatterns };
}

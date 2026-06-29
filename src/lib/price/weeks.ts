// Week assembly — PURE (no I/O). Turns a user's habit definitions + raw logs into
// the bucketed WeekInput[] the settlement fold consumes. Separated from runner.ts
// so it stays testable without the server-only marker the I/O shell carries.

import {
  addDays,
  compareLocalDate,
  diffDays,
  localDateInTz,
  weekStartOf,
  type LocalDate,
} from './dates';
import type { Area, PositionRole, PositionWeekInput, WeekInput } from './settlement';

// DB-shaped inputs (the runner maps Supabase rows to these).
export interface HabitRow {
  id: string;
  kind: string;
  cadence: string | null;
  area: string | null;
  status: string;
  created_at: string;
  term_started_on: string | null;
  recurrence_rule: unknown;
}
export interface LogRow {
  habit_id: string;
  status: string;
  local_date: string;
}

export function roleOf(h: HabitRow): PositionRole | null {
  if (h.kind === 'liability') return 'vice';
  if (h.kind === 'asset') return 'daily'; // morning | evening | mission all score per-day
  return null;
}

/**
 * Build one habit's aggregated outcome for its scored range within the week.
 *
 * `effectiveStart` is `max(week's rangeStart, the habit's creation date)` — a habit
 * created mid-week scores only the days it actually existed (pro-rata, mirroring how
 * week 0 itself is pro-rated from signup). It is never charged for days before it
 * existed, but DOES earn the normal per-day ± from its creation day onward.
 *
 * `todayLocal` splits the in-progress week at the local-midnight boundary so a
 * negative only materializes once a day has fully elapsed ("negative only at
 * midnight"): days in `[effectiveStart..yesterday]` score normally (a completion is
 * positive, an absence is a miss/slip), but `today` scores POSITIVE-ONLY — an
 * affirmative log adds, an absence is neutral (0), never a miss. Pass `null` for a
 * fully-elapsed (settled) week, which scores every day normally — settlement is
 * unaffected by this split.
 *
 * `fullWeek` is true only for a settled week the habit participated in from the
 * calendar week start (`wkStart`) — a real Mon→Sun week. It gates the
 * streak/recovery/collapse layer (partial weeks freeze it); the per-day
 * contribution books regardless.
 *
 * Vices are affirmative-only: "paid/avoided" is a `done` log; the slip is the
 * INFERRED absence of a `done` log on an elapsed day (never written, never today).
 */
function buildPosition(
  h: HabitRow,
  role: PositionRole,
  logs: LogRow[],
  effectiveStart: LocalDate,
  rangeEnd: LocalDate,
  wkStart: LocalDate,
  isComplete: boolean,
  todayLocal: LocalDate | null,
): PositionWeekInput {
  const inRange = (d: string) =>
    compareLocalDate(d, effectiveStart) >= 0 && compareLocalDate(d, rangeEnd) <= 0;
  const mine = logs.filter((l) => l.habit_id === h.id && inRange(l.local_date));
  const area = (h.area as Area | null) ?? null;

  // This habit's own day count within the week's scored range (pro-rated start).
  const daysInRange = diffDays(rangeEnd, effectiveStart) + 1;
  // The live week ends on today; a settled week passes todayLocal=null (no split).
  const isCurrent = todayLocal !== null && compareLocalDate(rangeEnd, todayLocal) === 0;
  const elapsedDays = isCurrent ? Math.max(daysInRange - 1, 0) : daysInRange;
  const isToday = (d: string) => isCurrent && compareLocalDate(d, todayLocal!) === 0;
  // Full Mon→Sun participation: a settled week, joined at the calendar start.
  const fullWeek = isComplete && compareLocalDate(effectiveStart, wkStart) === 0;

  if (role === 'vice') {
    const paid = mine.filter((l) => l.status === 'done');
    const paidToday = isCurrent ? paid.filter((l) => isToday(l.local_date)).length : 0;
    const paidElapsed = paid.length - paidToday;
    const relapseDays = Math.max(elapsedDays - paidElapsed, 0); // today is never a slip
    const scheduled = isCurrent ? elapsedDays + paidToday : daysInRange;
    return {
      habitId: h.id,
      role,
      area,
      completed: paid.length,
      failed: relapseDays,
      scheduled,
      target: scheduled, // per-day roles don't use a divisor; target mirrors scheduled
      fullWeek,
    };
  }
  // daily (morning + evening + mission): per-day done/miss. A completion credits on
  // any logged day; an elapsed day with no completion is a miss (negative only at
  // midnight — today un-done is neutral, never a miss).
  const done = mine.filter((l) => l.status === 'done');
  const doneToday = isCurrent ? done.filter((l) => isToday(l.local_date)).length : 0;
  const doneElapsed = done.length - doneToday;
  const missedDays = Math.max(elapsedDays - doneElapsed, 0);
  const scheduled = isCurrent ? elapsedDays + doneToday : daysInRange;
  return {
    habitId: h.id,
    role,
    area,
    completed: done.length,
    failed: missedDays,
    scheduled,
    target: scheduled, // per-day roles don't use a divisor; target mirrors scheduled
    fullWeek,
  };
}

export interface BuiltWeeks {
  complete: WeekInput[];
  current: WeekInput | null;
}

/** Assemble settlement weeks from signup to now, splitting complete vs in-progress. */
export function buildWeeks(
  signupLocal: LocalDate,
  currentLocal: LocalDate,
  weekStart: number,
  timezone: string,
  habits: HabitRow[],
  logs: LogRow[],
): BuiltWeeks {
  const firstWeekStart = weekStartOf(signupLocal, weekStart);
  const complete: WeekInput[] = [];
  let current: WeekInput | null = null;

  for (let i = 0; ; i++) {
    const wkStart = addDays(firstWeekStart, i * 7);
    const wkEnd = addDays(wkStart, 6);
    if (compareLocalDate(wkStart, currentLocal) > 0) break; // future week

    const isComplete = compareLocalDate(wkEnd, currentLocal) < 0;
    // Week 0 is pro-rata from signup. The in-progress week counts ONLY through
    // today — never the days that haven't happened yet, so the provisional mark
    // reflects what's actually been done so far.
    const rangeStart = i === 0 && compareLocalDate(signupLocal, wkStart) > 0 ? signupLocal : wkStart;
    const rangeEnd = isComplete ? wkEnd : currentLocal;
    const daysInWeek = diffDays(rangeEnd, rangeStart) + 1;

    const positions = habits
      .filter((h) => {
        if (h.status !== 'active') return false;
        // A habit participates if it existed by the scored range's END; one created
        // after this week ended never appears in it. A habit created mid-week DOES
        // participate, pro-rated from its creation day (effectiveStart below) — it's
        // never charged for days before it existed, but earns the per-day ± from then.
        const habitStart = localDateInTz(new Date(h.created_at), timezone);
        return compareLocalDate(habitStart, rangeEnd) <= 0;
      })
      .map((h) => {
        const role = roleOf(h)!;
        // Score from the later of the week's start and the habit's creation day.
        const habitStart = localDateInTz(new Date(h.created_at), timezone);
        const effectiveStart =
          compareLocalDate(habitStart, rangeStart) > 0 ? habitStart : rangeStart;
        // Settled weeks score every day normally (null); only the in-progress
        // week gets the today-neutral split.
        const todayLocal = isComplete ? null : currentLocal;
        return buildPosition(h, role, logs, effectiveStart, rangeEnd, wkStart, isComplete, todayLocal);
      });

    const wk: WeekInput = { weekIndex: i, weekStart: wkStart, weekEnd: wkEnd, daysInWeek, positions };

    if (isComplete) {
      complete.push(wk); // fully elapsed → settleable
    } else {
      current = wk; // in progress → provisional only
      break;
    }
  }
  return { complete, current };
}

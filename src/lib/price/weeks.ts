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
import { scheduledOccurrences, type RecurrenceRule } from './recurrence';
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
  if (h.kind === 'asset') return h.cadence === 'weekly' ? 'weekly' : 'daily';
  return null;
}

function parseRule(raw: unknown): RecurrenceRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.type === 'weekdays' && Array.isArray(r.days)) {
    return { type: 'weekdays', days: r.days.map(Number) };
  }
  if (r.type === 'every_n_days' && typeof r.n === 'number' && typeof r.anchor === 'string') {
    return { type: 'every_n_days', n: r.n, anchor: r.anchor };
  }
  return null;
}

/**
 * Build one habit's aggregated outcome for the week's scored range.
 *
 * `todayLocal` splits the in-progress week at the local-midnight boundary so a
 * negative only materializes once a day has fully elapsed ("negative only at
 * midnight"): days in `[rangeStart..yesterday]` score normally (a completion is
 * positive, an absence is a miss/slip), but `today` scores POSITIVE-ONLY — an
 * affirmative log adds, an absence is neutral (0), never a miss. Pass `null` for a
 * fully-elapsed (settled) week, which scores every day normally — settlement is
 * unaffected by this split.
 *
 * Vices are affirmative-only: "paid/avoided" is a `done` log; the slip is the
 * INFERRED absence of a `done` log on an elapsed day (never written, never today).
 */
function buildPosition(
  h: HabitRow,
  role: PositionRole,
  logs: LogRow[],
  rangeStart: LocalDate,
  rangeEnd: LocalDate,
  daysInWeek: number,
  todayLocal: LocalDate | null,
): PositionWeekInput {
  const inRange = (d: string) =>
    compareLocalDate(d, rangeStart) >= 0 && compareLocalDate(d, rangeEnd) <= 0;
  const mine = logs.filter((l) => l.habit_id === h.id && inRange(l.local_date));
  const area = (h.area as Area | null) ?? null;

  // The live week ends on today; a settled week passes todayLocal=null (no split).
  const isCurrent = todayLocal !== null && compareLocalDate(rangeEnd, todayLocal) === 0;
  const elapsedDays = isCurrent ? Math.max(daysInWeek - 1, 0) : daysInWeek;
  const isToday = (d: string) => isCurrent && compareLocalDate(d, todayLocal!) === 0;

  if (role === 'vice') {
    const paid = mine.filter((l) => l.status === 'done');
    const paidToday = isCurrent ? paid.filter((l) => isToday(l.local_date)).length : 0;
    const paidElapsed = paid.length - paidToday;
    const relapseDays = Math.max(elapsedDays - paidElapsed, 0); // today is never a slip
    return {
      habitId: h.id,
      role,
      area,
      completed: paid.length,
      failed: relapseDays,
      scheduled: isCurrent ? elapsedDays + paidToday : daysInWeek,
    };
  }
  if (role === 'daily') {
    const done = mine.filter((l) => l.status === 'done');
    const doneToday = isCurrent ? done.filter((l) => isToday(l.local_date)).length : 0;
    const doneElapsed = done.length - doneToday;
    const missedDays = Math.max(elapsedDays - doneElapsed, 0); // today un-done is not a miss
    return {
      habitId: h.id,
      role,
      area,
      completed: done.length,
      failed: missedDays,
      scheduled: isCurrent ? elapsedDays + doneToday : daysInWeek,
    };
  }
  // weekly: scheduled occurrences from the recurrence rule (default 1/week). Not
  // today-split in v0 — an occurrence due today still counts in the live mark.
  const rule = parseRule(h.recurrence_rule);
  const scheduled = rule ? scheduledOccurrences(rule, rangeStart, rangeEnd) : 1;
  const doneCount = mine.filter((l) => l.status === 'done').length;
  const completed = Math.min(doneCount, scheduled);
  return { habitId: h.id, role, area, completed, failed: Math.max(scheduled - completed, 0), scheduled };
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
        // A habit participates only if it existed by the scored range's start;
        // a habit created mid-week is never charged for days before it existed.
        const habitStart = localDateInTz(new Date(h.created_at), timezone);
        return compareLocalDate(habitStart, rangeStart) <= 0;
      })
      .map((h) => {
        const role = roleOf(h)!;
        // Settled weeks score every day normally (null); only the in-progress
        // week gets the today-neutral split.
        const todayLocal = isComplete ? null : currentLocal;
        return buildPosition(h, role, logs, rangeStart, rangeEnd, daysInWeek, todayLocal);
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

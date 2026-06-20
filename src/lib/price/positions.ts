// Pure display helpers for Home's position rows. No I/O — derived from a habit's
// dates + its raw logs, so they're unit-testable and the runner just feeds data.

import { compareLocalDate, diffDays, type LocalDate } from './dates';

/**
 * Asset progress: "day X of the term" (1-based), clamped to [1, termDays]. Null
 * when the habit carries no term (e.g. a liability, or term not started).
 */
export function dayOfTerm(
  termStartedOn: LocalDate | null,
  termDays: number | null,
  today: LocalDate,
): number | null {
  if (!termStartedOn || !termDays) return null;
  const raw = diffDays(today, termStartedOn) + 1;
  return Math.max(1, Math.min(raw, termDays));
}

/**
 * Vice clean run: whole days since the most recent relapse (0 if relapsed today),
 * or since the vice started if it has never relapsed. Future-dated relapses (none
 * should exist — the log endpoint rejects them) are ignored.
 */
export function daysClean(
  relapseDates: LocalDate[],
  startDate: LocalDate,
  today: LocalDate,
): number {
  const past = relapseDates.filter((d) => compareLocalDate(d, today) <= 0);
  if (past.length === 0) return Math.max(0, diffDays(today, startDate));
  const last = past.reduce((a, b) => (compareLocalDate(a, b) >= 0 ? a : b));
  return Math.max(0, diffDays(today, last));
}

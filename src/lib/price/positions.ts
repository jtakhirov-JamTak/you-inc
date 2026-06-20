// Pure display helpers for Home's position rows. No I/O — derived from a habit's
// dates + its raw logs, so they're unit-testable and the runner just feeds data.

import { addDays, compareLocalDate, diffDays, type LocalDate } from './dates';

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
 * Vice clean run: whole days since the most recent slip (0 if slipped yesterday),
 * or since the vice started if it has never slipped. Pass the INFERRED slip dates
 * (see inferredViceSlipDates) — a vice negative is the absence of a "paid/avoided"
 * log on an elapsed day, never a written row. Future-dated slips don't exist.
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

/**
 * The days an affirmative "paid/avoided" ('done') log is MISSING — i.e. the
 * inferred vice slips. Only fully-elapsed days count: today is excluded (an
 * unmarked vice today is neutral, not a slip — the negative materializes once the
 * day passes local midnight). Days before the vice's start never count.
 */
export function inferredViceSlipDates(
  doneDates: LocalDate[],
  startDate: LocalDate,
  today: LocalDate,
): LocalDate[] {
  const done = new Set(doneDates);
  const slips: LocalDate[] = [];
  // Walk elapsed days [startDate .. yesterday]; today (== `today`) is never a slip.
  for (let d = startDate; compareLocalDate(d, today) < 0; d = addDays(d, 1)) {
    if (!done.has(d)) slips.push(d);
  }
  return slips;
}

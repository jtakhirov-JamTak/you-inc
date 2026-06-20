// Recurrence engine for the weekly habit slot.
//
// The weekly slot supports a custom recurrence, so its scheduled occurrences per
// settlement week can vary. That count feeds the weekly "÷ days" divisor. Pure
// calendar math over the week's inclusive local-date range.

import { addDays, compareLocalDate, dayOfWeek, diffDays, type LocalDate } from './dates';

export type RecurrenceRule =
  // Every N days, counting from an anchor date (e.g. the habit's start).
  | { type: 'every_n_days'; n: number; anchor: LocalDate }
  // Specific weekdays (0 = Sunday … 6 = Saturday).
  | { type: 'weekdays'; days: number[] };

/** Count scheduled occurrences in the inclusive local-date range [start, end]. */
export function scheduledOccurrences(
  rule: RecurrenceRule,
  start: LocalDate,
  end: LocalDate,
): number {
  if (compareLocalDate(start, end) > 0) return 0;

  let count = 0;
  for (let d = start; compareLocalDate(d, end) <= 0; d = addDays(d, 1)) {
    if (rule.type === 'weekdays') {
      if (rule.days.includes(dayOfWeek(d))) count++;
    } else {
      // every_n_days: on/after the anchor, every nth day.
      if (rule.n > 0) {
        const delta = diffDays(d, rule.anchor);
        if (delta >= 0 && delta % rule.n === 0) count++;
      }
    }
  }
  return count;
}

// Pure local-calendar-date helpers for settlement.
//
// A "local date" is a 'YYYY-MM-DD' string in the USER's timezone. habit_logs
// already store local_date at write time, so settlement bucketing is calendar
// arithmetic — no timezone math — EXCEPT for one question: "what local date is it
// for this user right now," which decides whether a week has fully elapsed. That
// single tz-aware step uses Intl (DST-correct, no library). All arithmetic anchors
// at noon UTC so a day step can never cross a DST seam.

export type LocalDate = string; // 'YYYY-MM-DD'

export function parseLocalDate(d: LocalDate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day, 12, 0, 0, 0));
}

export function formatLocalDate(dt: Date): LocalDate {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(d: LocalDate, n: number): LocalDate {
  const dt = parseLocalDate(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return formatLocalDate(dt);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(d: LocalDate): number {
  return parseLocalDate(d).getUTCDay();
}

/** a − b, in whole days. */
export function diffDays(a: LocalDate, b: LocalDate): number {
  return Math.round((parseLocalDate(a).getTime() - parseLocalDate(b).getTime()) / 86_400_000);
}

export function compareLocalDate(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The local calendar date of an instant in an IANA timezone (DST-correct).
 * en-CA renders as YYYY-MM-DD.
 */
export function localDateInTz(instant: Date, timeZone: string): LocalDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * The start date of the settlement week containing `d`, given week_start
 * (0 = Sunday … 6 = Saturday).
 */
export function weekStartOf(d: LocalDate, weekStart: number): LocalDate {
  const delta = (dayOfWeek(d) - weekStart + 7) % 7;
  return addDays(d, -delta);
}

// The DISPLAY-only "day" boundary: the user's day runs 6 AM → 5:59 AM. Used by the
// Home chart + its period delta ONLY — scoring stays calendar-dated (founder ruling,
// see CLAUDE.md / scoring overrides). Deliberately NOT in price/config.ts (which is
// scoring constants only) and free of any `server-only` import, so the server runner
// and the client chart can share one definition instead of duplicating 6*60 / 1440.

/** 06:00 local, expressed as minutes since local 00:00. */
export const DAY_OPEN_MINUTE = 6 * 60;
/** Minutes in a day. */
export const DAY_MINUTES = 1440;

/**
 * Convert a minute-of-day (0..1439, since local 00:00) to minutes since the 6 AM
 * day-open (0..1439, where 0 = 6 AM and ~1439 = the next 5:59 AM).
 */
export function minutesSince6am(minuteOfDay: number): number {
  return (minuteOfDay - DAY_OPEN_MINUTE + DAY_MINUTES) % DAY_MINUTES;
}

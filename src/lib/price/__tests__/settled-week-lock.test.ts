import { describe, it, expect } from 'vitest';
import { SETTLEMENT_GRACE_DAYS } from '../config';
import { weekStartOf, addDays, compareLocalDate, dayOfWeek, type LocalDate } from '../dates';

// Parity guard for the TIME-BASED settled-week log lock (migration 0032). The lock
// predicate now lives in plpgsql (reject_settled_week_log), split from the TS engine,
// so this pins the two together:
//   • `sqlLockPredicate` is a LITERAL transcription of the 0032 plpgsql (hardcoded
//     grace = 1, its own dow/week-start arithmetic) — edit it only when the migration
//     changes.
//   • `engineLock` derives the same answer from the REAL weeks.ts/dates.ts helpers
//     (weekStartOf + SETTLEMENT_GRACE_DAYS), so if the grace constant or the week-start
//     math is ever tuned in TS, this side moves and the tuples below mismatch the SQL
//     mirror → the test fails, flagging that the migration must be bumped too.
// Each tuple also pins the human-reasoned expected boolean, anchoring both sides.

// Literal mirror of the 0032 trigger body (grace hardcoded to 1, as in the SQL).
function sqlLockPredicate(localDate: LocalDate, weekStart: number, today: LocalDate): boolean {
  const cGraceDays = 1; // matches c_grace_days in 0032
  const vDow = dayOfWeek(localDate); // extract(dow) — 0=Sun..6=Sat
  const vWkStart = addDays(localDate, -(((vDow - weekStart + 7) % 7)));
  const vWkEnd = addDays(vWkStart, 6);
  // v_today > v_wk_end + c_grace_days
  return compareLocalDate(today, addDays(vWkEnd, cGraceDays)) > 0;
}

// Engine-derived expectation from the shared helpers (the source of truth the SQL
// mirrors). Uses SETTLEMENT_GRACE_DAYS so a future tune surfaces the coupling.
function engineLock(localDate: LocalDate, weekStart: number, today: LocalDate): boolean {
  const wkStart = weekStartOf(localDate, weekStart);
  const wkEnd = addDays(wkStart, 6);
  return compareLocalDate(today, addDays(wkEnd, SETTLEMENT_GRACE_DAYS)) > 0;
}

describe('settled-week lock — time-based predicate (0032) matches the engine grace math', () => {
  // [localDate, weekStart, today, expectedLocked]
  const cases: [LocalDate, number, LocalDate, boolean][] = [
    // week_start = Monday(1): week Mon 2026-06-22 .. Sun 2026-06-28, grace boundary 06-29.
    ['2026-06-24', 1, '2026-06-28', false], // Sun (week_end) — week not yet past → open
    ['2026-06-24', 1, '2026-06-29', false], // grace day (today == boundary, not >) → open
    ['2026-06-24', 1, '2026-06-30', true], //  day after grace → LOCKED
    ['2026-06-24', 1, '2026-07-05', true], //  well past → LOCKED
    // current week Mon 2026-06-29 .. Sun 2026-07-05 (boundary 07-06): a fresh log stays open.
    ['2026-06-30', 1, '2026-06-30', false],
    ['2026-07-05', 1, '2026-07-06', false], // its own grace day → still open
    // week_start = Sunday(0): week Sun 2026-06-21 .. Sat 2026-06-27, grace boundary 06-28.
    ['2026-06-23', 0, '2026-06-27', false], // Sat (week_end) → open
    ['2026-06-23', 0, '2026-06-28', false], // grace day → open
    ['2026-06-23', 0, '2026-06-29', true], //  day after grace → LOCKED
  ];

  it.each(cases)(
    'local %s (week_start %i) on %s → locked=%s (SQL mirror == engine == expected)',
    (localDate, weekStart, today, expected) => {
      expect(sqlLockPredicate(localDate, weekStart, today)).toBe(expected);
      expect(engineLock(localDate, weekStart, today)).toBe(expected);
    },
  );

  it('the SQL mirror agrees with the engine across a dense date sweep', () => {
    // Every day of a ~5-week span, both week-start conventions, asserting the two
    // implementations never diverge (catches off-by-one / modulo bugs on any weekday).
    const start = new Date(Date.UTC(2026, 5, 1)); // 2026-06-01
    for (let d = 0; d < 35; d++) {
      const localDate = new Date(start.getTime() + d * 86_400_000).toISOString().slice(0, 10);
      for (const weekStart of [0, 1]) {
        for (let t = 0; t < 40; t++) {
          const today = new Date(start.getTime() + t * 86_400_000).toISOString().slice(0, 10);
          expect(sqlLockPredicate(localDate, weekStart, today)).toBe(
            engineLock(localDate, weekStart, today),
          );
        }
      }
    }
  });
});

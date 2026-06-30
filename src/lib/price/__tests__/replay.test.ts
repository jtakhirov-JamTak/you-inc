import { describe, it, expect, vi, afterEach } from 'vitest';
import type { WeekInput } from '../settlement';

// The PROJECTION-model guarantee, encoded. The price ledger is a pure function of
// the FROZEN facts (the settled_weeks snapshots) and the CURRENT scoring constants
// (the "version"). These tests pin the three invariants that make a tuning bump a
// safe REPLAY rather than a reset:
//   (a) determinism  — same facts + same version → identical output, every recompute
//   (b) path-independence — version A → B → A returns the ORIGINAL value (no hysteresis)
//   (c) tuning bites — a different version yields a different value (replay isn't a no-op)
//
// NOTE the phrasing: it is NOT "any version → same value" (that would assert
// version-invariance — a bug; the whole point of tuning is that values change).

// Frozen facts: two identical full weeks, each a single daily asset 3-of-7 done
// (4 missed) — UNCAPPED, so the per-done-day constant actually moves the total, and
// 'broken' each week so no streak/collapse layer fires (a clean habit-week total).
// This is the exact shape settled_weeks stores and the replay folds.
const FACTS: WeekInput[] = [0, 1].map((i) => ({
  weekIndex: i,
  weekStart: '2026-06-01',
  weekEnd: '2026-06-07',
  daysInWeek: 7,
  positions: [
    {
      habitId: 'd1',
      role: 'daily' as const,
      area: null,
      completed: 3,
      failed: 4,
      scheduled: 7,
      target: 7,
      fullWeek: true,
    },
  ],
}));

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('../config');
});

// Fold the SAME frozen facts under a constants override (a stand-in for a scoring
// "version"), re-importing the pure chain so the override propagates engine → settlement.
async function foldTotalWith(overrides: Record<string, unknown>): Promise<number> {
  vi.resetModules();
  vi.doMock('../config', async () => {
    const actual = await vi.importActual<typeof import('../config')>('../config');
    return { ...actual, ...overrides };
  });
  const { foldSettlements } = await import('../settlement');
  return foldSettlements(FACTS).reduce((sum, e) => sum + e.amountCents, 0);
}

// Two "versions" that differ only in the daily per-done-day rate (a routine tune).
const VERSION_A = { DAILY_HABIT: { perDoneDay: 0.25, perMissDay: 0.25, weekCapPos: 1.75, weekCapNeg: 1.75 } };
const VERSION_B = { DAILY_HABIT: { perDoneDay: 0.5, perMissDay: 0.25, weekCapPos: 1.75, weekCapNeg: 1.75 } };

describe('replay invariants — the projection is a pure function of (facts, version)', () => {
  it('(a) determinism: same facts + same version → identical events on every recompute', async () => {
    const { foldSettlements } = await import('../settlement');
    const once = foldSettlements(FACTS);
    const twice = foldSettlements(FACTS);
    expect(twice).toEqual(once); // no hidden state, no drift across recomputes
    // A deep clone folds identically — the fold never mutates its input facts.
    const clone = JSON.parse(JSON.stringify(FACTS)) as WeekInput[];
    expect(foldSettlements(clone)).toEqual(once);
  });

  it('(b) path-independence: version A → B → A returns the original value (no hysteresis)', async () => {
    const vA1 = await foldTotalWith(VERSION_A);
    const vB = await foldTotalWith(VERSION_B);
    const vA2 = await foldTotalWith(VERSION_A);
    expect(vA2).toBe(vA1); // tune-and-revert restores value EXACTLY — value lives in facts
    expect(vB).not.toBe(vA1); // and B genuinely differed (else the round-trip proves nothing)
  });

  it('(c) tuning bites: a different version yields a different value for a non-trivial history', async () => {
    const vA = await foldTotalWith(VERSION_A);
    const vB = await foldTotalWith(VERSION_B);
    // 3 done / 4 missed per week: A = (0.75 − 1.0)% = −0.25%/wk → −$500/wk; B = (1.5 − 1.0)%
    // = +0.5%/wk → +$1,000/wk. Over two weeks: A = −$1,000, B = +$2,000.
    expect(vA).toBe(-100_000);
    expect(vB).toBe(200_000);
  });
});

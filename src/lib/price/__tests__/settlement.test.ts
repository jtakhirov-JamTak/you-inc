import { describe, it, expect } from 'vitest';
import {
  foldSettlements,
  provisionalMarkCents,
  provisionalMarkByPosition,
  type PositionWeekInput,
  type WeekInput,
} from '../settlement';

// ── Roster builders ──────────────────────────────────────────────────────────────
// The roster is 1 vice + 3 per-day assets (morning + evening + mission, all the
// 'daily' role). fullWeek defaults true (a normal complete Mon→Sun week); pass false
// to model a partial week (signup mid-week, or a habit created mid-week). target and
// fullWeek are VESTIGIAL under v7 (kept only for frozen-snapshot shape stability)
// but the builders keep producing them — mirroring weeks.ts.
const vice = (completed: number, failed: number, scheduled = 7, id = 'v', fullWeek = true): PositionWeekInput => ({
  habitId: id, role: 'vice', area: null, completed, failed, scheduled, target: scheduled, fullWeek,
});
const daily = (completed: number, failed: number, scheduled = 7, id = 'd', fullWeek = true): PositionWeekInput => ({
  habitId: id, role: 'daily', area: null, completed, failed, scheduled, target: scheduled, fullWeek,
});

function week(weekIndex: number, positions: PositionWeekInput[], daysInWeek = 7): WeekInput {
  return { weekIndex, weekStart: '2026-01-01', weekEnd: '2026-01-07', daysInWeek, positions };
}

const perfectRoster = (): PositionWeekInput[] => [
  vice(7, 0, 7, 'v1'),
  daily(7, 0, 7, 'd1'), daily(7, 0, 7, 'd2'), daily(7, 0, 7, 'd3'),
];

const worstRoster = (): PositionWeekInput[] => [
  vice(0, 7, 7, 'v1'),
  daily(0, 7, 7, 'd1'), daily(0, 7, 7, 'd2'), daily(0, 7, 7, 'd3'),
];

// ── The v7 fold: one habit_week_settled event per non-empty week, nothing else ────
describe('foldSettlements — v7 (habit week contribution only)', () => {
  it('emits ONLY habit_week_settled events — the streak/recovery/collapse/pause layer is gone', () => {
    const events = foldSettlements([
      week(0, perfectRoster()), // would have booked 2 streak bonuses pre-v7
      week(1, worstRoster()),   // would have been a v6 PAUSE (all-zero) / booked collapses pre-v6
      week(2, [vice(0, 7, 7, 'v1'), daily(7, 0, 7, 'd1'), daily(7, 0, 7, 'd2'), daily(7, 0, 7, 'd3')]), // blown vice
    ]);
    expect(events).toHaveLength(3);
    for (const e of events) {
      expect(e.eventType).toBe('habit_week_settled');
      expect(e.settlementKey).toMatch(/^habit_week:\d+$/);
    }
  });

  it('a perfect full-roster week books the +7.0% cap (3×1.75 + 1.75)', () => {
    const hw = foldSettlements([week(0, perfectRoster())])[0];
    expect(hw.pct).toBeCloseTo(7.0, 6);
    expect(hw.amountCents).toBe(1_400_000); // +7% of $200k
  });

  it('a fully-missed full-roster week books the −8.75% cap (3×(−1.75) + (−3.5))', () => {
    const hw = foldSettlements([week(0, worstRoster())])[0];
    expect(hw.pct).toBeCloseTo(-8.75, 6);
    expect(hw.amountCents).toBe(-1_750_000); // −8.75% of $200k
  });

  it('a ZERO-LOG week books its full downside — the v6 pause (and its exploit) is deleted', () => {
    // Pre-v7 this exact week was a PAUSE and booked NOTHING, making the downside
    // opt-in (not logging ≡ pausing). Under v7 absence-of-log is an inferred
    // miss/slip and the week settles like any other.
    const events = foldSettlements([week(0, worstRoster())]);
    expect(events).toHaveLength(1);
    expect(events[0].amountCents).toBe(-1_750_000);
  });

  it('ORPHAN CONSISTENCY: every non-empty week yields exactly one habit_week:{i} key', () => {
    // The runner's orphan self-heal assumes a frozen week ↔ its habit_week ledger
    // row. v6 pause weeks violated this (frozen fact, no row → perpetual replay);
    // v7 restores the invariant for ANY mix of week outcomes.
    const weeks = [
      week(0, perfectRoster()),
      week(1, worstRoster()), // the old pause shape
      week(2, [daily(3, 4, 7, 'd1')]),
      week(3, []), // empty roster — the only week that books nothing
      week(4, [vice(2, 5, 7, 'v1')]),
    ];
    const keys = foldSettlements(weeks).map((e) => e.settlementKey);
    expect(keys).toEqual(['habit_week:0', 'habit_week:1', 'habit_week:2', 'habit_week:4']);
  });

  it('carries the per-area breakdown in metadata for the Board statements', () => {
    const w = week(0, [
      { ...vice(7, 0, 7, 'v1'), area: 'health' },
      { ...daily(7, 0, 7, 'd1'), area: 'wealth' },
      daily(7, 0, 7, 'd2'), // untagged → operations
    ]);
    const hw = foldSettlements([w])[0];
    const areaCents = hw.metadata?.areaCents as Record<string, number>;
    expect(areaCents.health).toBe(350_000); // vice +1.75%
    expect(areaCents.wealth).toBe(350_000); // daily +1.75%
    expect(areaCents.operations).toBe(350_000);
  });
});

describe('empty-roster weeks book nothing', () => {
  it('a week with no positions produces no events', () => {
    expect(foldSettlements([week(0, []), week(1, [])])).toEqual([]);
  });
});

describe('partial signup week (pro-rata)', () => {
  it('a 3-day perfect partial week books its per-day contribution', () => {
    // 3 clean vice days (+0.75) + 3 daily ×(3 done = +0.75) = +3.0%.
    const partial = week(0, [
      vice(3, 0, 3, 'v1', false),
      daily(3, 0, 3, 'd1', false), daily(3, 0, 3, 'd2', false), daily(3, 0, 3, 'd3', false),
    ], 3);
    const hw = foldSettlements([partial]).find((e) => e.eventType === 'habit_week_settled');
    expect(hw?.pct).toBeCloseTo(3.0, 6);
  });

  it('a disastrous 3-day partial week books its pro-rated downside (nothing more)', () => {
    // 3 relapse days (−1.5) + 3 daily ×(3 missed = −0.75) = −3.75%. Under v7 there
    // is no collapse layer to shield from — the per-day math IS the whole story.
    const blown = week(0, [
      vice(0, 3, 3, 'v1', false),
      daily(0, 3, 3, 'd1', false), daily(0, 3, 3, 'd2', false), daily(0, 3, 3, 'd3', false),
    ], 3);
    const events = foldSettlements([blown]);
    expect(events).toHaveLength(1);
    expect(events[0].pct).toBeCloseTo(-3.75, 6);
  });
});

describe('provisional mark (current open week, not booked)', () => {
  it('reflects completions so far against the baseline', () => {
    // Mid-week: 3 clean vice-days, 4 daily done each.
    const positions = [
      vice(3, 0, 3, 'v1'),
      daily(4, 0, 4, 'd1'), daily(4, 0, 4, 'd2'), daily(4, 0, 4, 'd3'),
    ];
    // vice +0.75, daily +1.0×3 = +3.0 → +3.75% of $200k = +$7,500.
    const cents = provisionalMarkCents(positions);
    expect(cents).toBe(750_000);
  });

  it('breaks the mark out per position (sums to the total)', () => {
    const positions = [
      vice(3, 0, 3, 'v1'),
      daily(4, 0, 4, 'd1'), daily(4, 0, 4, 'd2'), daily(4, 0, 4, 'd3'),
    ];
    const byPos = provisionalMarkByPosition(positions);
    expect(byPos.map((p) => p.habitId)).toEqual(['v1', 'd1', 'd2', 'd3']);
    // Vice +0.75% of $200k = +$1,500; each daily +1.0% = +$2,000.
    expect(byPos[0].cents).toBe(150_000);
    expect(byPos[1].cents).toBe(200_000);
    // Per-position cents sum to the total mark.
    expect(byPos.reduce((s, p) => s + p.cents, 0)).toBe(provisionalMarkCents(positions));
  });
});

describe('foldSettlements — idempotency + determinism (ledger integrity)', () => {
  const scenario = (): WeekInput[] => [
    week(0, perfectRoster()),
    week(1, perfectRoster()),
    week(2, worstRoster()),
  ];

  it('emits no duplicate settlement keys (upsert can never silently drop an event)', () => {
    const keys = foldSettlements(scenario()).map((e) => e.settlementKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('REPLAY DETERMINISM: the same frozen facts folded twice yield identical drafts', () => {
    const input = scenario();
    const snapshot = JSON.parse(JSON.stringify(input));
    const a = foldSettlements(input);
    const b = foldSettlements(input);
    expect(a).toEqual(b); // same input → identical events (and keys)
    expect(input).toEqual(snapshot); // input array untouched
  });
});

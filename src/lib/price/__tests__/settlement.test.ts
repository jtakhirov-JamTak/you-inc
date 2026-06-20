import { describe, it, expect } from 'vitest';
import {
  classifyCategory,
  foldSettlements,
  isCategoryFull,
  isTotalCollapse,
  isVicesCollapse,
  provisionalMarkCents,
  provisionalMarkByPosition,
  type PositionWeekInput,
  type WeekInput,
} from '../settlement';

// ── Roster builders ──────────────────────────────────────────────────────────────
const vice = (completed: number, failed: number, scheduled = 7, id = 'v'): PositionWeekInput => ({
  habitId: id, role: 'vice', area: null, completed, failed, scheduled,
});
const daily = (completed: number, failed: number, scheduled = 7, id = 'd'): PositionWeekInput => ({
  habitId: id, role: 'daily', area: null, completed, failed, scheduled,
});
const weekly = (completed: number, scheduled: number, id = 'w'): PositionWeekInput => ({
  habitId: id, role: 'weekly', area: null, completed, failed: scheduled - completed, scheduled,
});

function week(weekIndex: number, positions: PositionWeekInput[], daysInWeek = 7): WeekInput {
  return { weekIndex, weekStart: '2026-01-01', weekEnd: '2026-01-07', daysInWeek, positions };
}

const perfectRoster = (): PositionWeekInput[] => [
  vice(7, 0, 7, 'v1'), vice(7, 0, 7, 'v2'),
  daily(7, 0, 7, 'd1'), daily(7, 0, 7, 'd2'),
  weekly(3, 3, 'w1'),
];

// ── Classification ───────────────────────────────────────────────────────────────
describe('week classification', () => {
  it('a perfect roster is full in every category', () => {
    const w = week(0, perfectRoster());
    expect(isCategoryFull(w, 'vices')).toBe(true);
    expect(isCategoryFull(w, 'daily')).toBe(true);
    expect(isCategoryFull(w, 'weekly')).toBe(true);
  });

  it('one relapse breaks the vices streak (strict)', () => {
    const w = week(0, [vice(6, 1, 7, 'v1'), vice(7, 0, 7, 'v2'), daily(7, 0), daily(7, 0), weekly(3, 3)]);
    expect(isCategoryFull(w, 'vices')).toBe(false);
    expect(isCategoryFull(w, 'daily')).toBe(true);
  });

  it('vices collapse needs BOTH vices relapsed every day', () => {
    const both = week(0, [vice(0, 7, 7, 'v1'), vice(0, 7, 7, 'v2'), daily(7, 0), daily(7, 0), weekly(3, 3)]);
    expect(isVicesCollapse(both)).toBe(true);
    const one = week(0, [vice(0, 7, 7, 'v1'), vice(1, 6, 7, 'v2'), daily(7, 0), daily(7, 0), weekly(3, 3)]);
    expect(isVicesCollapse(one)).toBe(false);
  });

  it('total collapse needs vices fully collapsed AND zero on all assets', () => {
    const total = week(0, [vice(0, 7, 7, 'v1'), vice(0, 7, 7, 'v2'), daily(0, 7, 7, 'd1'), daily(0, 7, 7, 'd2'), weekly(0, 3)]);
    expect(isTotalCollapse(total)).toBe(true);
    // Did one asset → not total.
    const notTotal = week(0, [vice(0, 7, 7, 'v1'), vice(0, 7, 7, 'v2'), daily(3, 4, 7, 'd1'), daily(0, 7, 7, 'd2'), weekly(0, 3)]);
    expect(isTotalCollapse(notTotal)).toBe(false);
  });
});

// ── The fold ─────────────────────────────────────────────────────────────────────
describe('foldSettlements — streak progression', () => {
  it('three perfect weeks ramp each category 1.0 → 1.5 → 3.0', () => {
    const weeks = [0, 1, 2].map((i) => week(i, perfectRoster()));
    const events = foldSettlements(weeks);

    const vicesStreak = events.filter((e) => e.eventType === 'streak_bonus' && e.category === 'vices');
    expect(vicesStreak.map((e) => e.pct)).toEqual([1.0, 1.5, 3.0]);
    expect(vicesStreak.map((e) => e.settlementKey)).toEqual([
      'streak:vices:0', 'streak:vices:1', 'streak:vices:2',
    ]);

    // habit_week_settled present once per week at +11%.
    const hw = events.filter((e) => e.eventType === 'habit_week_settled');
    expect(hw).toHaveLength(3);
    expect(hw[0].pct).toBeCloseTo(11.0, 6);
    expect(hw[0].amountCents).toBe(2_200_000);
  });

  it('a missed week resets the streak and the next run uses the recovery ramp', () => {
    const w0 = week(0, perfectRoster());
    const w1 = week(1, [vice(7, 0, 7, 'v1'), vice(7, 0, 7, 'v2'), daily(6, 1, 7, 'd1'), daily(7, 0, 7, 'd2'), weekly(3, 3)]); // daily slips
    const w2 = week(2, perfectRoster());
    const events = foldSettlements([w0, w1, w2]);

    const daySt = events.filter((e) => e.category === 'daily');
    // wk0 streak run1, wk1 broke (no daily event), wk2 recovery run1.
    expect(daySt.map((e) => [e.weekIndex, e.eventType, e.pct])).toEqual([
      [0, 'streak_bonus', 1.0],
      [2, 'recovery_bonus', 1.0],
    ]);
    // Vices kept the streak through all three weeks → run reaches 3.
    const vicesWk2 = events.find((e) => e.category === 'vices' && e.weekIndex === 2);
    expect(vicesWk2?.eventType).toBe('streak_bonus');
    expect(vicesWk2?.pct).toBe(3.0);
  });
});

describe('skipped weekly week (nothing scheduled) freezes the streak', () => {
  it('classifyCategory distinguishes full / broken / skipped / absent', () => {
    expect(classifyCategory(week(0, [weekly(3, 3, 'w1')]), 'weekly')).toBe('full');
    expect(classifyCategory(week(0, [weekly(2, 3, 'w1')]), 'weekly')).toBe('broken');
    // Positions exist but nothing was scheduled this week.
    const skipped = week(0, [weekly(0, 0, 'w1')]);
    expect(classifyCategory(skipped, 'weekly')).toBe('skipped');
    // Regression: a 0-scheduled slot must NOT read as vacuously full.
    expect(isCategoryFull(skipped, 'weekly')).toBe(false);
    // No weekly position at all.
    expect(classifyCategory(week(0, [vice(7, 0, 7, 'v1')]), 'weekly')).toBe('absent');
  });

  it('a skipped week neither advances nor breaks the run — it freezes', () => {
    const events = foldSettlements([
      week(0, [weekly(3, 3, 'w1')]), // full → run 1
      week(1, [weekly(0, 0, 'w1')]), // skipped → frozen at 1, no bonus
      week(2, [weekly(3, 3, 'w1')]), // full → run 2 (continued, not reset, not 3)
    ]);
    const weeklyStreak = events.filter(
      (e) => e.eventType === 'streak_bonus' && e.category === 'weekly',
    );
    expect(
      weeklyStreak.map((e) => [e.weekIndex, e.metadata?.streakRun, e.pct]),
    ).toEqual([
      [0, 1, 1.0],
      [2, 2, 1.5],
    ]);
  });

  it('a broken week (occurrence missed) still resets, unlike a skipped one', () => {
    const events = foldSettlements([
      week(0, [weekly(3, 3, 'w1')]), // full → run 1
      week(1, [weekly(2, 3, 'w1')]), // scheduled but missed one → broken, reset
      week(2, [weekly(3, 3, 'w1')]), // recovery run 1
    ]);
    const weeklyEvents = events.filter((e) => e.category === 'weekly');
    expect(weeklyEvents.map((e) => [e.weekIndex, e.eventType, e.metadata?.streakRun])).toEqual([
      [0, 'streak_bonus', 1],
      [2, 'recovery_bonus', 1],
    ]);
  });
});

describe('foldSettlements — collapse stacking', () => {
  it('a total-collapse week books BOTH vices and total penalties', () => {
    const w = week(0, [vice(0, 7, 7, 'v1'), vice(0, 7, 7, 'v2'), daily(0, 7, 7, 'd1'), daily(0, 7, 7, 'd2'), weekly(0, 3)]);
    const events = foldSettlements([w]);
    const collapses = events.filter((e) => e.eventType === 'collapse_penalty');
    expect(collapses.map((e) => [e.category, e.pct]).sort()).toEqual([
      ['total', -2.5],
      ['vices', -1.0],
    ]);
  });

  it('consecutive vices collapses escalate -1 / -2 / -3', () => {
    const bad = (i: number) =>
      week(i, [vice(0, 7, 7, 'v1'), vice(0, 7, 7, 'v2'), daily(7, 0, 7, 'd1'), daily(7, 0, 7, 'd2'), weekly(3, 3)]);
    const events = foldSettlements([bad(0), bad(1), bad(2), bad(3)]);
    const vices = events.filter((e) => e.eventType === 'collapse_penalty' && e.category === 'vices');
    expect(vices.map((e) => e.pct)).toEqual([-1.0, -2.0, -3.0, -3.0]);
    // assets were perfect → no total collapse.
    expect(events.some((e) => e.category === 'total')).toBe(false);
  });
});

describe('partial signup week (pro-rata)', () => {
  it('a 3-day perfect week scores off the days that existed', () => {
    // 3 clean vice days each (+0.75×2), 3 daily done (+0.75×2), 1 weekly occ done (+4) = +7%.
    const w = week(0, [
      vice(3, 0, 3, 'v1'), vice(3, 0, 3, 'v2'),
      daily(3, 0, 3, 'd1'), daily(3, 0, 3, 'd2'),
      weekly(1, 1, 'w1'),
    ], 3);
    const hw = foldSettlements([w]).find((e) => e.eventType === 'habit_week_settled');
    expect(hw?.pct).toBeCloseTo(7.0, 6);
    // A perfect partial week still counts as a full streak week.
    expect(isCategoryFull(w, 'vices')).toBe(true);
  });
});

describe('provisional mark (current open week, not booked)', () => {
  it('reflects completions so far against the baseline', () => {
    // Mid-week: 3 clean vice-days each, 4 daily done each, weekly 2/3 done.
    const positions = [
      vice(3, 0, 3, 'v1'), vice(3, 0, 3, 'v2'),
      daily(4, 0, 4, 'd1'), daily(4, 0, 4, 'd2'),
      weekly(2, 3, 'w1'),
    ];
    // vices +0.75×2=1.5, daily +1.0×2=2.0, weekly (4/3)*2−(4/3)*1=+1.333 → +4.833%
    const cents = provisionalMarkCents(positions);
    expect(cents).toBe(966_667); // ≈ $9,666.67
  });

  it('breaks the mark out per position (sums to the total)', () => {
    const positions = [
      vice(3, 0, 3, 'v1'), vice(3, 0, 3, 'v2'),
      daily(4, 0, 4, 'd1'), daily(4, 0, 4, 'd2'),
      weekly(2, 3, 'w1'),
    ];
    const byPos = provisionalMarkByPosition(positions);
    expect(byPos.map((p) => p.habitId)).toEqual(['v1', 'v2', 'd1', 'd2', 'w1']);
    // Each vice +0.75% of $200k = +$1,500; each daily +1.0% = +$2,000.
    expect(byPos[0].cents).toBe(150_000);
    expect(byPos[2].cents).toBe(200_000);
    // Per-position cents sum to the total mark.
    expect(byPos.reduce((s, p) => s + p.cents, 0)).toBe(provisionalMarkCents(positions));
  });
});

describe('foldSettlements — idempotency + determinism (ledger integrity)', () => {
  const scenario = (): WeekInput[] => [
    week(0, perfectRoster()),
    week(1, perfectRoster()),
    // total collapse: breaks all streaks, books both collapse penalties.
    week(2, [vice(0, 7, 7, 'v1'), vice(0, 7, 7, 'v2'), daily(0, 7, 7, 'd1'), daily(0, 7, 7, 'd2'), weekly(0, 3, 'w1')]),
  ];

  it('emits no duplicate settlement keys (upsert can never silently drop an event)', () => {
    const keys = foldSettlements(scenario()).map((e) => e.settlementKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is deterministic and does not mutate its input', () => {
    const input = scenario();
    const snapshot = JSON.parse(JSON.stringify(input));
    const a = foldSettlements(input);
    const b = foldSettlements(input);
    expect(a).toEqual(b); // same input → identical events (and keys)
    expect(input).toEqual(snapshot); // input array untouched
  });
});

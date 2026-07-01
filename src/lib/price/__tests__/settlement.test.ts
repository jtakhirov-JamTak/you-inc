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
// The roster is now 1 vice + 3 per-day assets (morning + evening + mission, all the
// 'daily' role). fullWeek defaults true (a normal complete Mon→Sun week); pass false
// to model a partial week (signup mid-week, or a habit created mid-week).
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

// ── Classification ───────────────────────────────────────────────────────────────
describe('week classification', () => {
  it('a perfect roster is full in every category', () => {
    const w = week(0, perfectRoster());
    expect(isCategoryFull(w, 'vices')).toBe(true);
    expect(isCategoryFull(w, 'daily')).toBe(true);
  });

  it('one relapse breaks the vices streak (strict)', () => {
    const w = week(0, [vice(6, 1, 7, 'v1'), daily(7, 0, 7, 'd1'), daily(7, 0, 7, 'd2'), daily(7, 0, 7, 'd3')]);
    expect(isCategoryFull(w, 'vices')).toBe(false);
    expect(isCategoryFull(w, 'daily')).toBe(true);
  });

  it('vices collapse: the single vice relapsed every day collapses', () => {
    const collapsed = week(0, [vice(0, 7, 7, 'v1'), daily(7, 0, 7, 'd1'), daily(7, 0, 7, 'd2'), daily(7, 0, 7, 'd3')]);
    expect(isVicesCollapse(collapsed)).toBe(true);
    // one clean day → not a full collapse.
    const oneClean = week(0, [vice(1, 6, 7, 'v1'), daily(7, 0, 7, 'd1'), daily(7, 0, 7, 'd2'), daily(7, 0, 7, 'd3')]);
    expect(isVicesCollapse(oneClean)).toBe(false);
  });

  it('zero vices (mid-setup) never collapses; a full single-vice relapse does', () => {
    // Roster mid-setup with no vice yet — must never book a collapse penalty.
    const noVice = week(0, [daily(7, 0, 7, 'd1'), daily(7, 0, 7, 'd2'), daily(7, 0, 7, 'd3')]);
    expect(isVicesCollapse(noVice)).toBe(false);
    expect(isTotalCollapse(noVice)).toBe(false);
    expect(foldSettlements([noVice]).some((e) => e.eventType === 'collapse_penalty')).toBe(false);

    // With one vice present (the whole category), a full relapse DOES collapse.
    const oneViceCollapsed = week(0, [vice(0, 7, 7, 'v1'), daily(0, 7, 7, 'd1'), daily(0, 7, 7, 'd2'), daily(0, 7, 7, 'd3')]);
    expect(isVicesCollapse(oneViceCollapsed)).toBe(true);
    expect(isTotalCollapse(oneViceCollapsed)).toBe(true); // assets also all zero
  });

  it('total collapse needs the vice fully collapsed AND zero on all assets', () => {
    const total = week(0, [vice(0, 7, 7, 'v1'), daily(0, 7, 7, 'd1'), daily(0, 7, 7, 'd2'), daily(0, 7, 7, 'd3')]);
    expect(isTotalCollapse(total)).toBe(true);
    // Did one asset → not total.
    const notTotal = week(0, [vice(0, 7, 7, 'v1'), daily(3, 4, 7, 'd1'), daily(0, 7, 7, 'd2'), daily(0, 7, 7, 'd3')]);
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

    // habit_week_settled present once per week at +7%.
    const hw = events.filter((e) => e.eventType === 'habit_week_settled');
    expect(hw).toHaveLength(3);
    expect(hw[0].pct).toBeCloseTo(7.0, 6);
    expect(hw[0].amountCents).toBe(1_400_000);
  });

  it('a missed week resets the streak and the next run uses the recovery ramp', () => {
    const w0 = week(0, perfectRoster());
    const w1 = week(1, [vice(7, 0, 7, 'v1'), daily(6, 1, 7, 'd1'), daily(7, 0, 7, 'd2'), daily(7, 0, 7, 'd3')]); // a daily slips
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

describe('a category with nothing scheduled freezes the streak', () => {
  it('classifyCategory distinguishes full / broken / skipped / absent', () => {
    expect(classifyCategory(week(0, [daily(7, 0, 7, 'd1')]), 'daily')).toBe('full');
    expect(classifyCategory(week(0, [daily(6, 1, 7, 'd1')]), 'daily')).toBe('broken');
    // Positions exist but nothing was scheduled this week (synthetic 0-scheduled).
    const skipped = week(0, [daily(0, 0, 0, 'd1')]);
    expect(classifyCategory(skipped, 'daily')).toBe('skipped');
    // Regression: a 0-scheduled position must NOT read as vacuously full.
    expect(isCategoryFull(skipped, 'daily')).toBe(false);
    // No daily position at all.
    expect(classifyCategory(week(0, [vice(7, 0, 7, 'v1')]), 'daily')).toBe('absent');
  });

  it('a skipped week neither advances nor breaks the run — it freezes', () => {
    // 3 active assets (scale = 3/3 = 1) so the pcts isolate the freeze logic.
    const three = (c: number, f: number, s: number) => [
      daily(c, f, s, 'd1'), daily(c, f, s, 'd2'), daily(c, f, s, 'd3'),
    ];
    const events = foldSettlements([
      week(0, three(7, 0, 7)), // full → run 1
      week(1, three(0, 0, 0)), // skipped (nothing scheduled) → frozen at 1, no bonus
      week(2, three(7, 0, 7)), // full → run 2 (continued, not reset, not 3)
    ]);
    const dailyStreak = events.filter(
      (e) => e.eventType === 'streak_bonus' && e.category === 'daily',
    );
    expect(
      dailyStreak.map((e) => [e.weekIndex, e.metadata?.streakRun, e.pct]),
    ).toEqual([
      [0, 1, 1.0],
      [2, 2, 1.5],
    ]);
  });

  it('an absent category that later appears earns the STREAK ramp, not recovery (no over-credit)', () => {
    // Weeks 0–1: the user holds NO daily asset → category 'daily' is 'absent'
    // (mid-setup), NOT a miss. Weeks 2–3: they add assets and go perfect. The run
    // must use the streak ramp (1.0 → 1.5), not the recovery ramp (1.0 → 2.0) — the
    // user is not "recovering" a habit they never had. Regression for the bug where
    // 'absent' flipped missedYet and mis-routed the first run onto recovery.
    const events = foldSettlements([
      week(0, [vice(7, 0, 7, 'v1')]),
      week(1, [vice(7, 0, 7, 'v1')]),
      week(2, perfectRoster()),
      week(3, perfectRoster()),
    ]);
    const dailyBonus = events.filter((e) => e.category === 'daily');
    expect(dailyBonus.map((e) => [e.weekIndex, e.eventType, e.pct])).toEqual([
      [2, 'streak_bonus', 1.0],
      [3, 'streak_bonus', 1.5],
    ]);
  });

  it('a broken week (a miss) still resets, unlike a skipped one', () => {
    const events = foldSettlements([
      week(0, [daily(7, 0, 7, 'd1')]), // full → run 1
      week(1, [daily(6, 1, 7, 'd1')]), // scheduled but missed one → broken, reset
      week(2, [daily(7, 0, 7, 'd1')]), // recovery run 1
    ]);
    const dailyEvents = events.filter((e) => e.category === 'daily');
    expect(dailyEvents.map((e) => [e.weekIndex, e.eventType, e.metadata?.streakRun])).toEqual([
      [0, 'streak_bonus', 1],
      [2, 'recovery_bonus', 1],
    ]);
  });
});

describe('daily streak/recovery bonus scales by active asset count (×assets/3)', () => {
  // A week with `n` perfect daily assets + a perfect vice (so no collapse haircut).
  const fullDailyWeek = (idx: number, n: number): WeekInput =>
    week(idx, [
      vice(7, 0, 7, 'v1'),
      ...Array.from({ length: n }, (_, k) => daily(7, 0, 7, `d${k}`)),
    ]);
  const dailyBonus = (n: number) =>
    foldSettlements([fullDailyWeek(0, n)]).find(
      (e) => e.eventType === 'streak_bonus' && e.category === 'daily',
    );

  it('1 active asset → ⅓ of the bonus', () => {
    const e = dailyBonus(1);
    expect(e?.pct).toBeCloseTo(1.0 / 3, 4); // run-1 base = 1.0%
    expect(e?.metadata?.activeAssets).toBe(1);
  });

  it('2 active assets → ⅔ of the bonus', () => {
    const e = dailyBonus(2);
    expect(e?.pct).toBeCloseTo((1.0 * 2) / 3, 4);
    expect(e?.metadata?.activeAssets).toBe(2);
  });

  it('3 active assets → the full bonus', () => {
    const e = dailyBonus(3);
    expect(e?.pct).toBe(1.0);
    expect(e?.metadata?.activeAssets).toBe(3);
  });

  it('the vices bonus itself is NOT scaled by asset count', () => {
    const vicesB = foldSettlements([fullDailyWeek(0, 1)]).find(
      (e) => e.eventType === 'streak_bonus' && e.category === 'vices',
    );
    expect(vicesB?.pct).toBe(1.0); // single vice, run 1, unscaled
  });
});

describe('vice collapse haircut (50% off streak/recovery bonuses that week)', () => {
  it('halves the daily streak bonus in a week the vice fully collapses', () => {
    // 3 perfect assets (daily full, run-1 base 1.0%) but the vice slips every day.
    const w = week(0, [
      vice(0, 7, 7, 'v1'),
      daily(7, 0, 7, 'd1'), daily(7, 0, 7, 'd2'), daily(7, 0, 7, 'd3'),
    ]);
    const events = foldSettlements([w]);
    const dailyB = events.find((e) => e.eventType === 'streak_bonus' && e.category === 'daily');
    expect(dailyB?.pct).toBe(0.5); // 1.0 × 3/3 × 0.5 haircut
    expect(dailyB?.metadata?.vicesHaircut).toBe(0.5);
    // Vices category is broken (no vices bonus); the collapse penalty still books.
    expect(events.some((e) => e.eventType === 'streak_bonus' && e.category === 'vices')).toBe(false);
    expect(events.some((e) => e.eventType === 'collapse_penalty' && e.category === 'vices')).toBe(true);
  });

  it('no haircut when the vice did not fully collapse', () => {
    const w = week(0, [
      vice(7, 0, 7, 'v1'), // vice perfect → no collapse
      daily(7, 0, 7, 'd1'), daily(7, 0, 7, 'd2'), daily(7, 0, 7, 'd3'),
    ]);
    const dailyB = foldSettlements([w]).find(
      (e) => e.eventType === 'streak_bonus' && e.category === 'daily',
    );
    expect(dailyB?.pct).toBe(1.0);
    expect(dailyB?.metadata?.vicesHaircut).toBeUndefined();
  });
});

describe('empty-roster weeks book nothing', () => {
  it('a week with no positions produces no events', () => {
    expect(foldSettlements([week(0, []), week(1, [])])).toEqual([]);
  });
});

describe('foldSettlements — collapse stacking', () => {
  it('a blown vice with logged assets books a VICES collapse (total is now subsumed by pause)', () => {
    // You engaged (assets logged perfectly) but relapsed the vice every day → vices
    // collapse. total collapse (everything zero) is now unreachable: an all-zero week
    // is a PAUSE (books nothing), see the zero-log-pause suite below.
    const w = week(0, [vice(0, 7, 7, 'v1'), daily(7, 0, 7, 'd1'), daily(7, 0, 7, 'd2'), daily(7, 0, 7, 'd3')]);
    const events = foldSettlements([w]);
    const collapses = events.filter((e) => e.eventType === 'collapse_penalty');
    expect(collapses.map((e) => [e.category, e.pct])).toEqual([['vices', -0.5]]);
    expect(events.some((e) => e.category === 'total')).toBe(false);
  });

  it('consecutive vices collapses escalate -0.5 / -1 / -1.5', () => {
    const bad = (i: number) =>
      week(i, [vice(0, 7, 7, 'v1'), daily(7, 0, 7, 'd1'), daily(7, 0, 7, 'd2'), daily(7, 0, 7, 'd3')]);
    const events = foldSettlements([bad(0), bad(1), bad(2), bad(3)]);
    const vices = events.filter((e) => e.eventType === 'collapse_penalty' && e.category === 'vices');
    expect(vices.map((e) => e.pct)).toEqual([-0.5, -1.0, -1.5, -1.5]);
    // assets were perfect → no total collapse.
    expect(events.some((e) => e.category === 'total')).toBe(false);
  });
});

describe('foldSettlements — zero-log complete week = PAUSE (v6)', () => {
  const pauseWeek = (i: number) =>
    week(i, [vice(0, 7, 7, 'v1'), daily(0, 7, 7, 'd1'), daily(0, 7, 7, 'd2'), daily(0, 7, 7, 'd3')]);

  it('a complete week with zero completions everywhere books NOTHING', () => {
    expect(foldSettlements([pauseWeek(0)])).toEqual([]);
  });

  it('a week with even ONE log is NOT paused — scores normally and can still collapse', () => {
    // One asset logged once → not a pause. Vice fully failed → vices collapse still books.
    const w = week(0, [vice(0, 7, 7, 'v1'), daily(1, 6, 7, 'd1'), daily(0, 7, 7, 'd2'), daily(0, 7, 7, 'd3')]);
    const events = foldSettlements([w]);
    expect(events.some((e) => e.eventType === 'habit_week_settled')).toBe(true);
    expect(events.some((e) => e.eventType === 'collapse_penalty' && e.category === 'vices')).toBe(true);
  });

  it('a pause FREEZES a streak (books a streak, not a recovery, at the resumed run)', () => {
    const events = foldSettlements([week(0, perfectRoster()), pauseWeek(1), week(2, perfectRoster())]);
    // Week 2 resumes the run at 2 (week 1 was frozen, not a break) → streak, not recovery.
    const wk2 = events.filter((e) => e.weekIndex === 2);
    const streak = wk2.find((e) => e.eventType === 'streak_bonus' && e.category === 'daily');
    expect(streak).toBeDefined();
    expect(streak!.metadata?.streakRun).toBe(2);
    expect(wk2.some((e) => e.eventType === 'recovery_bonus')).toBe(false);
  });

  it('a pause FREEZES the collapse ladder (−0.5 → pause → −1.0, not reset)', () => {
    // Assets logged (perfect) so weeks 0/2 are vices collapses, not pauses; week 1 is a pause.
    const collapse = (i: number) =>
      week(i, [vice(0, 7, 7, 'v1'), daily(7, 0, 7, 'd1'), daily(7, 0, 7, 'd2'), daily(7, 0, 7, 'd3')]);
    const events = foldSettlements([collapse(0), pauseWeek(1), collapse(2)]);
    const vices = events.filter((e) => e.eventType === 'collapse_penalty' && e.category === 'vices');
    expect(vices.map((e) => [e.weekIndex, e.pct])).toEqual([[0, -0.5], [2, -1.0]]);
  });

  it('a PARTIAL zero-log week is NOT paused (still books its pro-rated contribution)', () => {
    const partial = week(0, [
      vice(0, 3, 3, 'v1', false),
      daily(0, 3, 3, 'd1', false), daily(0, 3, 3, 'd2', false), daily(0, 3, 3, 'd3', false),
    ], 3);
    const events = foldSettlements([partial]);
    expect(events.some((e) => e.eventType === 'habit_week_settled')).toBe(true);
    // Partial weeks are shielded from collapse (fullWeek=false).
    expect(events.some((e) => e.eventType === 'collapse_penalty')).toBe(false);
  });
});

describe('partial signup week (pro-rata)', () => {
  // Partial-week positions carry fullWeek=false (set by buildWeeks).
  const partialWeek = (idx: number): WeekInput =>
    week(idx, [
      vice(3, 0, 3, 'v1', false),
      daily(3, 0, 3, 'd1', false), daily(3, 0, 3, 'd2', false), daily(3, 0, 3, 'd3', false),
    ], 3);

  it('a 3-day perfect week still books its per-day contribution', () => {
    // 3 clean vice days (+0.75) + 3 daily ×(3 done = +0.75) = +3.0%.
    const hw = foldSettlements([partialWeek(0)]).find((e) => e.eventType === 'habit_week_settled');
    expect(hw?.pct).toBeCloseTo(3.0, 6);
  });

  it('but a partial week is NOT a full streak week (frozen, no bonus)', () => {
    const w = partialWeek(0);
    expect(isCategoryFull(w, 'vices')).toBe(false);
    expect(classifyCategory(w, 'vices')).toBe('skipped');
    // No streak/recovery bonus is booked for the partial week.
    const events = foldSettlements([w]);
    expect(
      events.some((e) => e.eventType === 'streak_bonus' || e.eventType === 'recovery_bonus'),
    ).toBe(false);
  });

  it('the first FULL Mon→Sun week starts the streak run at 1', () => {
    const events = foldSettlements([partialWeek(0), week(1, perfectRoster())]);
    // Week 0 (partial): contribution only, no bonus. Week 1 (full): run 1 @ +1.0%.
    const vicesBonus = events.filter((e) => e.eventType === 'streak_bonus' && e.category === 'vices');
    expect(vicesBonus.map((e) => [e.weekIndex, e.metadata?.streakRun, e.pct])).toEqual([
      [1, 1, 1.0],
    ]);
  });

  it('a disastrous partial week books no collapse penalty (shielded)', () => {
    const blown = week(0, [
      vice(0, 3, 3, 'v1', false),
      daily(0, 3, 3, 'd1', false), daily(0, 3, 3, 'd2', false), daily(0, 3, 3, 'd3', false),
    ], 3);
    expect(isVicesCollapse(blown)).toBe(false);
    expect(isTotalCollapse(blown)).toBe(false);
    expect(foldSettlements([blown]).some((e) => e.eventType === 'collapse_penalty')).toBe(false);
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
    // total collapse: breaks all streaks, books both collapse penalties.
    week(2, [vice(0, 7, 7, 'v1'), daily(0, 7, 7, 'd1'), daily(0, 7, 7, 'd2'), daily(0, 7, 7, 'd3')]),
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

import { describe, it, expect } from 'vitest';
import { BASELINE_CENTS } from '../config';
import {
  centsFromPct,
  operatingValueCents,
  recoveryBonusPct,
  settleHabitWeek,
  settlePositionPct,
  settlementKey,
  sprintBandLabel,
  sprintBandPct,
  buildSprintGrid,
  unrealizedSprintPct,
  sprintPayoff,
  sprintRealizedCents,
  streakBonusPct,
  totalCollapsePct,
  vicesCollapsePct,
  type PositionWeek,
} from '../engine';

// The fixed roster: 1 vice + 3 daily assets (morning + evening + mission).
const fullWeek: PositionWeek[] = [
  { kind: 'vice', cleanDays: 7, relapseDays: 0 },
  { kind: 'daily', doneDays: 7, missedDays: 0 },
  { kind: 'daily', doneDays: 7, missedDays: 0 },
  { kind: 'daily', doneDays: 7, missedDays: 0 },
];

const zeroWeek: PositionWeek[] = [
  { kind: 'vice', cleanDays: 0, relapseDays: 7 },
  { kind: 'daily', doneDays: 0, missedDays: 7 },
  { kind: 'daily', doneDays: 0, missedDays: 7 },
  { kind: 'daily', doneDays: 0, missedDays: 7 },
];

describe('habit weekly settlement — roster bounds', () => {
  it('a perfect week is +7.00% = +$14,000', () => {
    // vice +1.75 (cap) + 3 daily ×+1.75 (cap) = +7.0%.
    const r = settleHabitWeek(fullWeek);
    expect(r.totalPct).toBeCloseTo(7.0, 6);
    expect(r.totalCents).toBe(1_400_000);
  });

  it('a total-miss week is -8.75% = -$17,500', () => {
    // vice -3.5 (cap) + 3 daily ×-1.75 (cap) = -8.75%.
    const r = settleHabitWeek(zeroWeek);
    expect(r.totalPct).toBeCloseTo(-8.75, 6);
    expect(r.totalCents).toBe(-1_750_000);
  });
});

describe('individual positions', () => {
  it('vice: partial week nets clean minus relapse, each side capped', () => {
    // 5 clean (+1.25) + 2 relapse (-1.00) = +0.25%
    expect(settlePositionPct({ kind: 'vice', cleanDays: 5, relapseDays: 2 })).toBeCloseTo(0.25, 6);
    // caps: all clean → +1.75; all relapse → -3.50
    expect(settlePositionPct({ kind: 'vice', cleanDays: 7, relapseDays: 0 })).toBeCloseTo(1.75, 6);
    expect(settlePositionPct({ kind: 'vice', cleanDays: 0, relapseDays: 7 })).toBeCloseTo(-3.5, 6);
  });

  it('daily habit: ±0.25/day capped at ±1.75', () => {
    expect(settlePositionPct({ kind: 'daily', doneDays: 7, missedDays: 0 })).toBeCloseTo(1.75, 6);
    expect(settlePositionPct({ kind: 'daily', doneDays: 0, missedDays: 7 })).toBeCloseTo(-1.75, 6);
    expect(settlePositionPct({ kind: 'daily', doneDays: 4, missedDays: 3 })).toBeCloseTo(0.25, 6);
  });
});

describe('money conversion + rounding', () => {
  it('1.75% of baseline = $3,500', () => {
    expect(centsFromPct(1.75, BASELINE_CENTS)).toBe(350_000);
  });

  it('4%÷3 of baseline rounds half-away-from-zero to $2,666.67', () => {
    expect(centsFromPct(4 / 3, BASELINE_CENTS)).toBe(266_667);
  });

  it('negative percents round symmetrically', () => {
    expect(centsFromPct(-(4 / 3), BASELINE_CENTS)).toBe(-266_667);
  });
});

describe('streak bonus ramp (SOT)', () => {
  it.each([
    [1, 1.0], [2, 1.5], [3, 3.0], [4, 3.0], [5, 4.5], [6, 4.5], [7, 2.5],
    [10, 2.5], [11, 4.5], [13, 6.0], [14, 6.0], [15, 4.5], [16, 4.5], [17, 3.0], [40, 3.0],
  ])('week %i → %f%%', (week, pct) => {
    expect(streakBonusPct(week)).toBeCloseTo(pct, 6);
  });

  it('week 0 or negative → 0', () => {
    expect(streakBonusPct(0)).toBe(0);
    expect(streakBonusPct(-3)).toBe(0);
  });
});

describe('recovery bonus ramp (SOT)', () => {
  it.each([[1, 1.0], [2, 2.0], [3, 3.0], [4, 4.0], [5, 5.0], [6, 6.0]])(
    'recovery week %i → %f%%',
    (week, pct) => {
      expect(recoveryBonusPct(week)).toBeCloseTo(pct, 6);
    },
  );

  it('week 7+ matches the regular streak (2.5% at week 7)', () => {
    expect(recoveryBonusPct(7)).toBeCloseTo(streakBonusPct(7), 6);
    expect(recoveryBonusPct(7)).toBeCloseTo(2.5, 6);
  });
});

describe('collapse penalties — independent and stacking (v5 rebalance)', () => {
  it('vices collapse: -0.5 / -1 / -1.5, held at -1.5', () => {
    expect(vicesCollapsePct(1)).toBeCloseTo(-0.5, 6);
    expect(vicesCollapsePct(2)).toBeCloseTo(-1.0, 6);
    expect(vicesCollapsePct(3)).toBeCloseTo(-1.5, 6);
    expect(vicesCollapsePct(9)).toBeCloseTo(-1.5, 6);
  });

  it('total collapse: -1.5 / -2.5 / -3, held at -3', () => {
    expect(totalCollapsePct(1)).toBeCloseTo(-1.5, 6);
    expect(totalCollapsePct(2)).toBeCloseTo(-2.5, 6);
    expect(totalCollapsePct(3)).toBeCloseTo(-3.0, 6);
    expect(totalCollapsePct(9)).toBeCloseTo(-3.0, 6);
  });

  it('a total wipeout stacks both penalties (week 3+ → -4.5% combined)', () => {
    const combined = vicesCollapsePct(3) + totalCollapsePct(3);
    expect(combined).toBeCloseTo(-4.5, 6);
    // Worst whole week ≈ habit -8.75 + this -4.5 = -13.25% ≈ +13% best realistic week.
  });
});

describe('sprint payoff', () => {
  it('band boundaries are >lower..upper inclusive', () => {
    expect(sprintBandPct('small', 0)).toBeCloseTo(-7.0, 6); // exactly 0%
    expect(sprintBandPct('small', 0.2)).toBeCloseTo(-5.5, 6); // 20% in >0–20
    expect(sprintBandPct('small', 0.5)).toBeCloseTo(0.0, 6); // 50% in >40–50
    expect(sprintBandPct('big', 0.99)).toBeCloseTo(12.0, 6); // 99% in >85–99
    expect(sprintBandPct('big', 1.0)).toBeCloseTo(14.0, 6); // 100% in >99
  });

  it('Big at $200k: complete+goal → +$40,000; miss entirely → -$28,000', () => {
    const win = sprintPayoff('big', 10, 10, true);
    expect(win.realizedPct).toBeCloseTo(20.0, 6); // 14% band + 6% goal bonus
    expect(sprintRealizedCents(win.realizedPct, BASELINE_CENTS)).toBe(4_000_000);

    const loss = sprintPayoff('big', 0, 10, false);
    expect(loss.realizedPct).toBeCloseTo(-14.0, 6);
    expect(sprintRealizedCents(loss.realizedPct, BASELINE_CENTS)).toBe(-2_800_000);
  });

  it('goal bonus is upside-only (never subtracted)', () => {
    const noGoal = sprintPayoff('medium', 6, 10, false); // >50–70 → +1.5
    expect(noGoal.goalBonusPct).toBe(0);
    const withGoal = sprintPayoff('medium', 6, 10, true);
    expect(withGoal.goalBonusPct).toBeCloseTo(5.0, 6);
    expect(withGoal.realizedPct).toBeCloseTo(6.5, 6);
  });

  it('sprint stakes scale with the set-time balance, not the baseline', () => {
    // Big at $500k → +$100k / -$70k envelope.
    const win = sprintPayoff('big', 10, 10, true);
    expect(sprintRealizedCents(win.realizedPct, 50_000_000)).toBe(10_000_000);
    const loss = sprintPayoff('big', 0, 10, false);
    expect(sprintRealizedCents(loss.realizedPct, 50_000_000)).toBe(-7_000_000);
  });

  it('no tasks → treated as 0% completion', () => {
    expect(sprintPayoff('small', 0, 0, false).completionRatio).toBe(0);
  });
});

describe('operating value fold', () => {
  it('empty ledger = baseline ($200,000)', () => {
    expect(operatingValueCents([])).toBe(BASELINE_CENTS);
  });

  it('baseline + sum of events', () => {
    expect(operatingValueCents([2_200_000, -2_900_000, 350_000])).toBe(BASELINE_CENTS - 350_000);
  });
});

describe('settlement keys are stable + deterministic', () => {
  it('formats', () => {
    expect(settlementKey.habitWeek(4)).toBe('habit_week:4');
    expect(settlementKey.streak('vices', 4)).toBe('streak:vices:4');
    expect(settlementKey.recovery('daily', 9)).toBe('recovery:daily:9');
    expect(settlementKey.collapse('total', 2)).toBe('collapse:total:2');
    expect(settlementKey.sprintRealized('abc-123')).toBe('sprint_realized:abc-123');
  });
});

describe('settleHabitWeek — defensive WEEK_MAX clamp', () => {
  it('an oversized non-standard roster is clamped to +11%', () => {
    const sevenDaily = Array.from({ length: 7 }, () => ({ kind: 'daily', doneDays: 7, missedDays: 0 }) as const);
    expect(settleHabitWeek(sevenDaily).totalPct).toBeCloseTo(11.0, 6); // raw 12.25 → clamped
  });

  it('is clamped to -14.5% on the downside', () => {
    const tenDaily = Array.from({ length: 10 }, () => ({ kind: 'daily', doneDays: 0, missedDays: 7 }) as const);
    expect(settleHabitWeek(tenDaily).totalPct).toBeCloseTo(-14.5, 6); // raw -17.5 → clamped
  });
});

describe('sprintBandPct — exact-boundary completion stays in the inclusive band', () => {
  it('40% via 2/5 lands in >20–40, not the next band', () => {
    expect(sprintBandPct('small', 2 / 5)).toBeCloseTo(-3.5, 6);
    expect(sprintBandPct('big', 2 / 5)).toBeCloseTo(-7.0, 6);
  });
});

describe('sprintBandLabel — completion ratio → band label', () => {
  it('maps each tier to its human label', () => {
    expect(sprintBandLabel(0)).toBe('0%');
    expect(sprintBandLabel(0.2)).toBe('1–20%'); // exact boundary stays inclusive
    expect(sprintBandLabel(0.75)).toBe('71–85%');
    expect(sprintBandLabel(1)).toBe('100%');
  });
});

describe('unrealizedSprintPct — banded on done/total (== close, band only)', () => {
  const mk = (specs: [boolean, number | null][]) => specs.map(([done, dueDay]) => ({ done, dueDay }));

  it('equals sprintBandPct at the current done/total ratio for every size', () => {
    for (const size of ['small', 'medium', 'big'] as const) {
      // 3 of 5 done → 0.6 ratio.
      const marks = mk([[true, 1], [true, 2], [true, 3], [false, 4], [false, 5]]);
      expect(unrealizedSprintPct(size, marks)).toBeCloseTo(sprintBandPct(size, 3 / 5), 6);
    }
  });

  it('equals the close band payoff (sprintPayoff.bandPct) at the frozen completion', () => {
    // 6 of 10 done → whatever settlement would band it at, sans goal bonus.
    const marks = mk(Array.from({ length: 10 }, (_, i) => [i < 6, null] as [boolean, number | null]));
    const live = unrealizedSprintPct('medium', marks);
    const settled = sprintPayoff('medium', 6, 10, false).bandPct;
    expect(live).toBeCloseTo(settled, 6);
  });

  it('nothing done → worst band (matches closing now with 0 completion)', () => {
    expect(unrealizedSprintPct('big', mk([[false, 3], [false, 7], [false, 12]]))).toBeCloseTo(
      sprintBandPct('big', 0),
      6,
    );
  });

  it('all done → best band; due dates are ignored (mirrors close = done/total)', () => {
    expect(unrealizedSprintPct('big', mk([[true, 3], [true, 14]]))).toBeCloseTo(14, 6);
    // two undone, whatever their due days → 0% completion → worst band.
    expect(unrealizedSprintPct('big', mk([[false, 3], [false, 14]]))).toBeCloseTo(-14, 6);
  });

  it('no tasks → worst band (0% completion, same as sprintPayoff)', () => {
    expect(unrealizedSprintPct('small', [])).toBeCloseTo(sprintBandPct('small', 0), 6);
  });
});

describe('buildSprintGrid — frozen dollar envelope at a basis', () => {
  it('prices the Big envelope at $200k → +$40k complete / −$28k miss', () => {
    const grid = buildSprintGrid('big', BASELINE_CENTS);
    // Best = full completion (+14%) + goal bonus (+6%) = +20% of $200k = +$40k.
    expect(grid.bestCents).toBe(4_000_000);
    // Worst = the 0% band (−14%) of $200k = −$28k.
    expect(grid.worstCents).toBe(-2_800_000);
    expect(grid.goalBonusCents).toBe(1_200_000); // +6%
    expect(grid.bands).toHaveLength(8);
  });

  it('scales absolute dollars with the basis (Big at $500k → +$100k / −$70k)', () => {
    const grid = buildSprintGrid('big', 50_000_000);
    expect(grid.worstCents).toBe(-7_000_000); // −14%
    // Full band alone (no goal) at $500k = +14% = +$70k.
    expect(grid.bands[grid.bands.length - 1].cents).toBe(7_000_000);
  });
});

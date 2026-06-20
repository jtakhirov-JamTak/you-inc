import { describe, it, expect } from 'vitest';
import { attributeSprintsToWeeks, buildWeekStatements } from '../statements';
import { BASELINE_CENTS } from '../config';
import type { LedgerEventDraft } from '../settlement';

const habitWeek = (
  weekIndex: number,
  weekEnd: string,
  amountCents: number,
  areaCents: Record<string, number>,
): LedgerEventDraft => ({
  eventType: 'habit_week_settled',
  settlementKey: `habit_week:${weekIndex}`,
  weekIndex,
  weekEnd,
  pct: 0,
  amountCents,
  basisCents: BASELINE_CENTS,
  metadata: { areaCents },
});

const bonus = (weekIndex: number, weekEnd: string, amountCents: number): LedgerEventDraft => ({
  eventType: 'streak_bonus',
  settlementKey: `streak:daily:${weekIndex}`,
  weekIndex,
  weekEnd,
  pct: 0,
  amountCents,
  basisCents: BASELINE_CENTS,
  category: 'daily',
});

describe('buildWeekStatements', () => {
  it('returns an empty series for no events', () => {
    expect(buildWeekStatements([])).toEqual([]);
  });

  it('accumulates a running closing value from the baseline', () => {
    const out = buildWeekStatements([
      habitWeek(0, '2026-01-07', 100_000, { health: 100_000 }),
      habitWeek(1, '2026-01-14', -40_000, { wealth: -40_000 }),
    ]);
    expect(out.map((w) => w.closingCents)).toEqual([
      BASELINE_CENTS + 100_000,
      BASELINE_CENTS + 100_000 - 40_000,
    ]);
    expect(out.map((w) => w.deltaCents)).toEqual([100_000, -40_000]);
  });

  it('sorts out-of-order weeks before folding the running total', () => {
    const out = buildWeekStatements([
      habitWeek(2, '2026-01-21', 30_000, { health: 30_000 }),
      habitWeek(0, '2026-01-07', 10_000, { health: 10_000 }),
      habitWeek(1, '2026-01-14', 20_000, { health: 20_000 }),
    ]);
    expect(out.map((w) => w.weekIndex)).toEqual([0, 1, 2]);
    expect(out[2].closingCents).toBe(BASELINE_CENTS + 60_000);
  });

  it('sums multiple events in the same week into one statement', () => {
    const out = buildWeekStatements([
      habitWeek(0, '2026-01-07', 100_000, { health: 60_000, wealth: 40_000 }),
      bonus(0, '2026-01-07', 25_000),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].deltaCents).toBe(125_000);
    // bonus folds into operations; areas reconcile to the delta.
    const a = out[0].areaCents;
    expect(a).toEqual({ health: 60_000, wealth: 40_000, relationships: 0, operations: 25_000 });
    expect(a.health + a.wealth + a.relationships + a.operations).toBe(out[0].deltaCents);
  });

  it('folds untagged habit areas into operations', () => {
    const out = buildWeekStatements([
      habitWeek(0, '2026-01-07', 50_000, { operations: 50_000 }),
    ]);
    expect(out[0].areaCents.operations).toBe(50_000);
  });

  it('includes attributed sprint_realized events in the closing value (operations)', () => {
    const sprintEvent = {
      eventType: 'sprint_realized',
      weekIndex: 1,
      weekEnd: '2026-01-14',
      amountCents: 75_000,
    };
    const out = buildWeekStatements([
      habitWeek(0, '2026-01-07', 100_000, { health: 100_000 }),
      habitWeek(1, '2026-01-14', 20_000, { health: 20_000 }),
      sprintEvent,
    ]);
    // Week 1's delta + closing must include the sprint, folded into operations.
    expect(out[1].deltaCents).toBe(20_000 + 75_000);
    expect(out[1].closingCents).toBe(BASELINE_CENTS + 100_000 + 20_000 + 75_000);
    expect(out[1].areaCents.operations).toBe(75_000);
  });
});

const wk = (weekIndex: number, weekStart: string, weekEnd: string) => ({ weekIndex, weekStart, weekEnd });

describe('attributeSprintsToWeeks', () => {
  const weeks = [wk(0, '2026-01-01', '2026-01-07'), wk(1, '2026-01-08', '2026-01-14')];

  it('places a sprint in the complete week containing its close-date', () => {
    const out = attributeSprintsToWeeks([{ amountCents: 50_000, localDate: '2026-01-10' }], weeks);
    expect(out).toEqual([
      { eventType: 'sprint_realized', weekIndex: 1, weekEnd: '2026-01-14', amountCents: 50_000 },
    ]);
  });

  it('matches inclusive week boundaries (weekStart and weekEnd)', () => {
    expect(attributeSprintsToWeeks([{ amountCents: 1, localDate: '2026-01-01' }], weeks)[0].weekIndex).toBe(0);
    expect(attributeSprintsToWeeks([{ amountCents: 1, localDate: '2026-01-14' }], weeks)[0].weekIndex).toBe(1);
  });

  it('drops a sprint that closed outside any complete week (still-open current week)', () => {
    expect(attributeSprintsToWeeks([{ amountCents: 50_000, localDate: '2026-01-20' }], weeks)).toEqual([]);
  });
});

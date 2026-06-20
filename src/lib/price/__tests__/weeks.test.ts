import { describe, it, expect } from 'vitest';
import { buildWeeks, type HabitRow, type LogRow } from '../weeks';
import { foldSettlements, isVicesCollapse } from '../settlement';

const habit = (id: string, kind: string, cadence: string | null, created_at: string): HabitRow => ({
  id, kind, cadence, area: null, status: 'active', created_at, term_started_on: null, recurrence_rule: null,
});
const log = (habit_id: string, status: string, local_date: string): LogRow => ({ habit_id, status, local_date });

describe('buildWeeks — current week counts only elapsed days', () => {
  it('a perfect 3-days-in week has no phantom misses', () => {
    const habits = [habit('d1', 'asset', 'daily', '2026-06-01T00:00:00Z')];
    const logs = [
      log('d1', 'done', '2026-06-01'),
      log('d1', 'done', '2026-06-02'),
      log('d1', 'done', '2026-06-03'),
    ];
    // Signup Mon 06-01, week starts Mon, today Wed 06-03 → week 0 in progress.
    const { complete, current } = buildWeeks('2026-06-01', '2026-06-03', 1, 'UTC', habits, logs);
    expect(complete).toHaveLength(0);
    expect(current?.daysInWeek).toBe(3);
    expect(current?.positions.find((p) => p.habitId === 'd1')).toMatchObject({
      completed: 3, failed: 0, scheduled: 3, // not failed:4 against a phantom 7-day week
    });
  });

  it('an unmarked vice accrues slips on ELAPSED days only (today neutral)', () => {
    const habits = [habit('v1', 'liability', null, '2026-06-01T00:00:00Z')];
    // Signup Mon 06-01, today Wed 06-03 → elapsed = 06-01, 06-02 (today excluded).
    const { current } = buildWeeks('2026-06-01', '2026-06-03', 1, 'UTC', habits, []);
    expect(current?.positions.find((p) => p.habitId === 'v1')).toMatchObject({
      completed: 0, failed: 2, scheduled: 2, // 2 elapsed unpaid days = 2 slips; today not a slip
    });
  });
});

describe('buildWeeks — negative only at local midnight (today-neutral split)', () => {
  it('a daily habit un-done TODAY is neutral, not a miss', () => {
    const habits = [habit('d1', 'asset', 'daily', '2026-06-01T00:00:00Z')];
    const logs = [log('d1', 'done', '2026-06-01'), log('d1', 'done', '2026-06-02')];
    // today 06-03, un-done today → elapsed days both done → no miss yet.
    const { current } = buildWeeks('2026-06-01', '2026-06-03', 1, 'UTC', habits, logs);
    expect(current?.positions.find((p) => p.habitId === 'd1')).toMatchObject({
      completed: 2, failed: 0,
    });
  });

  it('a daily habit missed on a PAST day this week IS a miss', () => {
    const habits = [habit('d1', 'asset', 'daily', '2026-06-01T00:00:00Z')];
    const logs = [log('d1', 'done', '2026-06-01')]; // gap on 06-02 (elapsed), nothing today
    const { current } = buildWeeks('2026-06-01', '2026-06-03', 1, 'UTC', habits, logs);
    expect(current?.positions.find((p) => p.habitId === 'd1')).toMatchObject({
      completed: 1, failed: 1, // 06-02 elapsed-undone = a miss; 06-03 today neutral
    });
  });

  it("today's check adds a positive (credited even though it's today)", () => {
    const habits = [habit('d1', 'asset', 'daily', '2026-06-01T00:00:00Z')];
    const logs = [
      log('d1', 'done', '2026-06-01'),
      log('d1', 'done', '2026-06-02'),
      log('d1', 'done', '2026-06-03'),
    ];
    const { current } = buildWeeks('2026-06-01', '2026-06-03', 1, 'UTC', habits, logs);
    expect(current?.positions.find((p) => p.habitId === 'd1')).toMatchObject({
      completed: 3, failed: 0, scheduled: 3,
    });
  });

  it('a vice marked paid today only: today credited, elapsed unpaid days slip', () => {
    const habits = [habit('v1', 'liability', null, '2026-06-01T00:00:00Z')];
    const logs = [log('v1', 'done', '2026-06-03')]; // paid today; 06-01/06-02 unpaid
    const { current } = buildWeeks('2026-06-01', '2026-06-03', 1, 'UTC', habits, logs);
    expect(current?.positions.find((p) => p.habitId === 'v1')).toMatchObject({
      completed: 1, failed: 2,
    });
  });

  it('a vice paid every elapsed day (not today) has no slips', () => {
    const habits = [habit('v1', 'liability', null, '2026-06-01T00:00:00Z')];
    const logs = [log('v1', 'done', '2026-06-01'), log('v1', 'done', '2026-06-02')];
    const { current } = buildWeeks('2026-06-01', '2026-06-03', 1, 'UTC', habits, logs);
    expect(current?.positions.find((p) => p.habitId === 'v1')).toMatchObject({
      completed: 2, failed: 0,
    });
  });

  it('the current week\'s FIRST day being today is fully neutral (no elapsed days)', () => {
    const habits = [
      habit('d1', 'asset', 'daily', '2026-06-08T00:00:00Z'),
      habit('v1', 'liability', null, '2026-06-08T00:00:00Z'),
    ];
    // Signup Mon 06-08, today Mon 06-08 → week 0 in progress, daysInWeek 1, elapsed 0.
    const { current } = buildWeeks('2026-06-08', '2026-06-08', 1, 'UTC', habits, []);
    expect(current?.positions.find((p) => p.habitId === 'd1')).toMatchObject({
      completed: 0, failed: 0,
    });
    expect(current?.positions.find((p) => p.habitId === 'v1')).toMatchObject({
      completed: 0, failed: 0,
    });
  });
});

describe('buildWeeks — mid-week habits do not score pre-existence days', () => {
  it('a habit created after the range start is excluded that week', () => {
    const habits = [
      habit('d1', 'asset', 'daily', '2026-06-01T00:00:00Z'),
      habit('d2', 'asset', 'daily', '2026-06-02T00:00:00Z'), // created day 2
    ];
    const { current } = buildWeeks('2026-06-01', '2026-06-03', 1, 'UTC', habits, []);
    const ids = current?.positions.map((p) => p.habitId) ?? [];
    expect(ids).toContain('d1');
    expect(ids).not.toContain('d2');
  });
});

describe('buildWeeks — complete vs in-progress split', () => {
  it('elapsed weeks settle in full; the live week is partial', () => {
    const habits = [habit('d1', 'asset', 'daily', '2026-06-01T00:00:00Z')];
    // Signup Mon 06-01, today Wed 06-10 → week 0 complete (7d), week 1 in progress (3d).
    const { complete, current } = buildWeeks('2026-06-01', '2026-06-10', 1, 'UTC', habits, []);
    expect(complete.map((w) => w.weekIndex)).toEqual([0]);
    expect(complete[0].daysInWeek).toBe(7);
    expect(current?.weekIndex).toBe(1);
    expect(current?.daysInWeek).toBe(3);
  });
});

describe('buildWeeks → settlement — complete weeks score vices by paid-day count', () => {
  it('a settled vice counts paid (done) days; unpaid days are slips', () => {
    const habits = [habit('v1', 'liability', null, '2026-06-01T00:00:00Z')];
    // Paid 5 of week 0's 7 days; week 0 is complete (today is next week).
    const logs = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'].map((d) =>
      log('v1', 'done', d),
    );
    const { complete } = buildWeeks('2026-06-01', '2026-06-10', 1, 'UTC', habits, logs);
    expect(complete[0].positions.find((p) => p.habitId === 'v1')).toMatchObject({
      completed: 5, failed: 2, scheduled: 7, // settled week scores every day (no today-split)
    });
  });

  it('a fully-UNPAID complete week still books a vices collapse (both vices)', () => {
    const habits = [
      habit('v1', 'liability', null, '2026-06-01T00:00:00Z'),
      habit('v2', 'liability', null, '2026-06-01T00:00:00Z'),
    ];
    // No 'done' logs anywhere → every elapsed day of week 0 is an inferred slip.
    const { complete } = buildWeeks('2026-06-01', '2026-06-10', 1, 'UTC', habits, []);
    expect(isVicesCollapse(complete[0])).toBe(true);
    const events = foldSettlements([complete[0]]);
    expect(
      events.some((e) => e.eventType === 'collapse_penalty' && e.category === 'vices'),
    ).toBe(true);
  });
});

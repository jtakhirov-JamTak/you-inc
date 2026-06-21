import { describe, it, expect } from 'vitest';
import { buildWeeks, type HabitRow, type LogRow } from '../weeks';
import { foldSettlements, isVicesCollapse } from '../settlement';

const habit = (
  id: string,
  kind: string,
  cadence: string | null,
  created_at: string,
  recurrence_rule: unknown = null,
): HabitRow => ({
  id, kind, cadence, area: null, status: 'active', created_at, term_started_on: null, recurrence_rule,
});
const weekdays = (...days: number[]) => ({ type: 'weekdays', days });
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

describe('buildWeeks — mid-week habits score per-day from their creation day', () => {
  it('a habit created mid-week is included, pro-rated from its creation day', () => {
    const habits = [
      habit('d1', 'asset', 'daily', '2026-06-01T00:00:00Z'),
      habit('d2', 'asset', 'daily', '2026-06-02T00:00:00Z'), // created day 2
    ];
    // Signup Mon 06-01, today Wed 06-03 → week 0 in progress.
    const { current } = buildWeeks('2026-06-01', '2026-06-03', 1, 'UTC', habits, []);
    const ids = current?.positions.map((p) => p.habitId) ?? [];
    expect(ids).toContain('d1');
    expect(ids).toContain('d2'); // no longer excluded — pro-rated instead
    // d1 existed since 06-01: elapsed 06-01/06-02 (today 06-03 neutral) → 2 scheduled.
    expect(current?.positions.find((p) => p.habitId === 'd1')).toMatchObject({
      completed: 0, failed: 2, scheduled: 2,
    });
    // d2 created 06-02: only 06-02 elapsed (06-03 today neutral, 06-01 predates it).
    expect(current?.positions.find((p) => p.habitId === 'd2')).toMatchObject({
      completed: 0, failed: 1, scheduled: 1,
    });
  });

  it("today's completion on a habit created today is credited (positive-only)", () => {
    const habits = [habit('d1', 'asset', 'daily', '2026-06-03T00:00:00Z')];
    const logs = [log('d1', 'done', '2026-06-03')]; // created + done today
    // Signup Mon 06-01, today Wed 06-03 → habit exists only today (0 elapsed days).
    const { current } = buildWeeks('2026-06-01', '2026-06-03', 1, 'UTC', habits, logs);
    expect(current?.positions.find((p) => p.habitId === 'd1')).toMatchObject({
      completed: 1, failed: 0, scheduled: 1, // today's done adds; no phantom miss
    });
  });

  it('a habit created mid-week is NOT full-week eligible even once the week settles', () => {
    const habits = [
      habit('d1', 'asset', 'daily', '2026-06-01T00:00:00Z'), // since the week start
      habit('d2', 'asset', 'daily', '2026-06-03T00:00:00Z'), // created mid-week
    ];
    // Signup Mon 06-01, today 06-10 → week 0 (06-01..06-07) is complete/settled.
    const { complete } = buildWeeks('2026-06-01', '2026-06-10', 1, 'UTC', habits, []);
    const d1 = complete[0].positions.find((p) => p.habitId === 'd1');
    const d2 = complete[0].positions.find((p) => p.habitId === 'd2');
    expect(d1?.fullWeek).toBe(true); // existed from the Monday → counts for streaks
    expect(d2?.fullWeek).toBe(false); // joined mid-week → frozen out of streaks
    expect(d2?.scheduled).toBe(5); // 06-03..06-07 = 5 days, not the full 7
  });
});

describe('buildWeeks — weekly target divides by the FULL week, not occurrences-so-far', () => {
  // Week Mon 2026-06-15 → Sun 06-21; [1,4,6] = Mon/Thu/Sat (target 3/week).
  it('1 of a 3×/week habit done today = +1/3, not the whole week', () => {
    // Created Sat 06-20, worked out Sat → only Sat was do-able; +1/3 of the cap.
    const habits = [habit('w1', 'asset', 'weekly', '2026-06-20T00:00:00Z', weekdays(1, 4, 6))];
    const logs = [log('w1', 'done', '2026-06-20')];
    const { current } = buildWeeks('2026-06-19', '2026-06-20', 1, 'UTC', habits, logs);
    expect(current?.positions.find((p) => p.habitId === 'w1')).toMatchObject({
      completed: 1, failed: 0, scheduled: 1, target: 3, fullWeek: false,
    });
  });

  it('a settled full week with 1 of 3 done settles to −1/3 (symmetric)', () => {
    // Existed the whole week (created on the Monday); did Monday only, missed Thu+Sat.
    const habits = [habit('w1', 'asset', 'weekly', '2026-06-15T00:00:00Z', weekdays(1, 4, 6))];
    const logs = [log('w1', 'done', '2026-06-15')];
    const { complete } = buildWeeks('2026-06-15', '2026-06-25', 1, 'UTC', habits, logs);
    expect(complete[0].positions.find((p) => p.habitId === 'w1')).toMatchObject({
      completed: 1, failed: 2, scheduled: 3, target: 3, fullWeek: true,
    });
  });

  it('mid-week: scheduled days that have ELAPSED undone count against you (today excepted)', () => {
    // Existed all week, today Fri 06-19: Mon+Thu elapsed undone → −2/3; Sat not due.
    const habits = [habit('w1', 'asset', 'weekly', '2026-06-15T00:00:00Z', weekdays(1, 4, 6))];
    const { current } = buildWeeks('2026-06-15', '2026-06-19', 1, 'UTC', habits, []);
    expect(current?.positions.find((p) => p.habitId === 'w1')).toMatchObject({
      completed: 0, failed: 2, scheduled: 2, target: 3, fullWeek: false,
    });
  });

  it('an occurrence whose only day predates the habit is 0-of-0 (inert, not a miss)', () => {
    // Friday-only habit created Saturday → Friday already gone → nothing do-able.
    const habits = [habit('w1', 'asset', 'weekly', '2026-06-20T00:00:00Z', weekdays(5))];
    const { current } = buildWeeks('2026-06-19', '2026-06-20', 1, 'UTC', habits, []);
    expect(current?.positions.find((p) => p.habitId === 'w1')).toMatchObject({
      completed: 0, failed: 0, scheduled: 0, target: 1, fullWeek: false,
    });
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

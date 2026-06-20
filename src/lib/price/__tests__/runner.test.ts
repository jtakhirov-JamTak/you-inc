import { describe, it, expect } from 'vitest';
import { buildWeeks, type HabitRow, type LogRow } from '../runner';

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

  it('a vice is not over-credited for days that have not happened', () => {
    const habits = [habit('v1', 'liability', null, '2026-06-01T00:00:00Z')];
    const { current } = buildWeeks('2026-06-01', '2026-06-03', 1, 'UTC', habits, []);
    expect(current?.positions.find((p) => p.habitId === 'v1')).toMatchObject({
      completed: 3, failed: 0, scheduled: 3, // 3 clean days so far, not a full 7
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

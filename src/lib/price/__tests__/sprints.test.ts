import { describe, it, expect } from 'vitest';
import { buildHomeSprints, type SprintRow, type SprintTaskRow } from '../sprints';

const sprint = (over: Partial<SprintRow> & { id: string }): SprintRow => ({
  size: 'medium',
  area: 'health',
  thesis: 'Reclaim mornings',
  term_days: 14,
  status: 'active',
  queue_position: null,
  set_time_balance_cents: 20_000_000,
  opened_at: null,
  ...over,
});

let taskSeq = 0;
const task = (sprint_id: string, done: boolean, due_day: number | null = null): SprintTaskRow => {
  const n = taskSeq++;
  return { id: `t${n}`, title: `task ${n}`, sprint_id, done, position: n, due_day };
};

describe('buildHomeSprints', () => {
  it('returns no active/queued for an empty roster', () => {
    expect(buildHomeSprints([], [], '2026-01-10', 'UTC')).toEqual({ active: null, queued: [] });
  });

  it('shapes the single active sprint with its task counts', () => {
    const { active, queued } = buildHomeSprints(
      [sprint({ id: 's1', opened_at: '2026-01-05T00:00:00Z', term_days: 14 })],
      [task('s1', true), task('s1', false), task('s1', true)],
      '2026-01-10',
      'UTC',
    );
    expect(queued).toEqual([]);
    expect(active).not.toBeNull();
    expect(active!.sprintId).toBe('s1');
    expect(active!.status).toBe('active');
    expect(active!.completedTasks).toBe(2);
    expect(active!.totalTasks).toBe(3);
    expect(active!.dayOfTerm).toBe(6); // opened 01-05, today 01-10 → day 6
    // Still running (day 6 of 14) → no dollar mark yet (card shows task-% instead).
    expect(active!.unrealizedReturnCents).toBeNull();
    expect(active!.startsInDays).toBeNull();
  });

  it('orders queued sprints by queue_position and staggers their start offsets', () => {
    const { queued } = buildHomeSprints(
      [
        sprint({ id: 'a', status: 'active', opened_at: '2026-01-05T00:00:00Z', term_days: 14 }),
        sprint({ id: 'q2', status: 'queued', queue_position: 2, term_days: 10 }),
        sprint({ id: 'q1', status: 'queued', queue_position: 1, term_days: 12 }),
      ],
      [],
      '2026-01-10',
      'UTC',
    );
    // active has 8 days left (14 − day 6); first queued starts then, next after its term.
    expect(queued.map((q) => q.sprintId)).toEqual(['q1', 'q2']);
    expect(queued[0].startsInDays).toBe(8);
    expect(queued[1].startsInDays).toBe(8 + 12);
    expect(queued.every((q) => q.dayOfTerm === null && q.unrealizedReturnCents === null)).toBe(true);
  });

  // Founder ruling: no dollar figure until the sprint's term (due date) has elapsed;
  // task-completion % is shown while it runs. When surfaced, the dollar is the BANDED
  // value on done/total, so it equals what closing now would book (band only).
  it('withholds the dollar while the sprint is still running', () => {
    const { active } = buildHomeSprints(
      [sprint({ id: 's1', size: 'big', opened_at: '2026-01-10T00:00:00Z', term_days: 14 })],
      [task('s1', true), task('s1', false), task('s1', false)],
      '2026-01-13', // day 4 of 14 → still running
      'UTC',
    );
    expect(active!.dayOfTerm).toBe(4);
    expect(active!.unrealizedReturnCents).toBeNull();
    expect(active!.completedTasks).toBe(1);
    expect(active!.totalTasks).toBe(3);
  });

  it('surfaces the banded dollar once the term has elapsed (== close band payoff)', () => {
    const { active } = buildHomeSprints(
      // medium, basis $200,000; 2 of 3 done → 0.667 → 51–70% band → +1.5%.
      [
        sprint({
          id: 's1',
          size: 'medium',
          opened_at: '2026-01-05T00:00:00Z',
          term_days: 14,
          set_time_balance_cents: 20_000_000,
        }),
      ],
      [task('s1', true), task('s1', true), task('s1', false)],
      '2026-01-25', // well past the 14-day term → dayOfTerm clamps to 14
      'UTC',
    );
    expect(active!.dayOfTerm).toBe(14);
    // +1.5% of $200,000 = +$3,000 (100_000ths of a dollar → 300_000 cents).
    expect(active!.unrealizedReturnCents).toBe(300_000);
  });
});

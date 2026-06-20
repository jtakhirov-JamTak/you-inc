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
    expect(active!.unrealizedReturnCents).not.toBeNull();
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

  // M2: the live unrealized return tallies proportionally per milestone, and only
  // once a milestone day has ended undone — never on day 1.
  it('unrealized is $0 on day 1 with all milestones in the future and nothing done', () => {
    const { active } = buildHomeSprints(
      [sprint({ id: 's1', size: 'big', opened_at: '2026-01-10T00:00:00Z', term_days: 14 })],
      [task('s1', false, 3), task('s1', false, 7), task('s1', false, 12)],
      '2026-01-10', // opened today → day 1
      'UTC',
    );
    expect(active!.dayOfTerm).toBe(1);
    expect(active!.unrealizedReturnCents).toBe(0);
  });

  it('subtracts a proportional slice once a milestone day has ended undone', () => {
    const { active } = buildHomeSprints(
      [sprint({ id: 's1', size: 'big', opened_at: '2026-01-10T00:00:00Z', term_days: 14 })],
      [task('s1', false, 3), task('s1', false, 7), task('s1', false, 12)],
      '2026-01-14', // day 5 → the day-3 milestone ended undone; days 7 & 12 still pending
      'UTC',
    );
    expect(active!.dayOfTerm).toBe(5);
    // 1 of 3 milestones missed → −14% / 3 of $200,000 = −$933.33 (rounded).
    expect(active!.unrealizedReturnCents).toBe(-933_333);
  });

  it('adds a done task’s slice immediately, even before its milestone day', () => {
    const { active } = buildHomeSprints(
      [sprint({ id: 's1', size: 'medium', opened_at: '2026-01-10T00:00:00Z', term_days: 14 })],
      [task('s1', true, 10), task('s1', false, 12)],
      '2026-01-11', // day 2 → nothing overdue; one task done early
      'UTC',
    );
    // medium upside +10% × 1/2 done = +5% of $200,000 = +$10,000.
    expect(active!.unrealizedReturnCents).toBe(1_000_000);
  });
});

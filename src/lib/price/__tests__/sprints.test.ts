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

const task = (sprint_id: string, done: boolean): SprintTaskRow => ({ sprint_id, done });

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
});

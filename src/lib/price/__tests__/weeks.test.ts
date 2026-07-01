import { describe, it, expect } from 'vitest';
import { buildWeeks, type HabitRow, type LogRow } from '../weeks';
import { foldSettlements, isVicesCollapse } from '../settlement';

const habit = (
  id: string,
  kind: string,
  cadence: string | null,
  created_at: string,
  deact?: { status: string; archived_at?: string; graduated_at?: string },
): HabitRow => ({
  id, kind, cadence, area: null,
  status: deact?.status ?? 'active',
  created_at, term_started_on: null, recurrence_rule: null,
  archived_at: deact?.archived_at ?? null,
  graduated_at: deact?.graduated_at ?? null,
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

describe('buildWeeks — settled weeks are invariant to later roster additions', () => {
  it("a habit added in a later week never changes an EARLIER complete week's booking", () => {
    // Signup Mon 06-01; today 06-15 → weeks 0 (06-01..07) and 1 (06-08..14) settled.
    // d1 did 5 of week 0's 7 days (a non-trivial amount to pin).
    const logs = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'].map((d) =>
      log('d1', 'done', d),
    );
    const base = [habit('d1', 'asset', 'daily', '2026-06-01T00:00:00Z')];
    const withLater = [...base, habit('d2', 'asset', 'daily', '2026-06-10T00:00:00Z')]; // created in week 1
    const wk0Of = (habits: HabitRow[]) =>
      foldSettlements(buildWeeks('2026-06-01', '2026-06-15', 1, 'UTC', habits, logs).complete).find(
        (e) => e.eventType === 'habit_week_settled' && e.weekIndex === 0,
      );
    // Adding d2 (created in week 1) must leave week 0's booking byte-for-byte identical:
    // the irreversible-ledger invariant, asserted in the pure core (not just the DB lock).
    expect(wk0Of(withLater)).toEqual(wk0Of(base));
  });
});

describe('buildWeeks — fullWeek eligibility (streak gate)', () => {
  it('a Monday signup makes week 0 full-week eligible; a mid-week signup does not', () => {
    // 2026-06-01 is a Monday (week_start = 1). Habit created the same day.
    const monday = buildWeeks(
      '2026-06-01',
      '2026-06-15',
      1,
      'UTC',
      [habit('d1', 'asset', 'daily', '2026-06-01T00:00:00Z')],
      [],
    );
    expect(monday.complete[0].positions.find((p) => p.habitId === 'd1')?.fullWeek).toBe(true);
    // Tuesday signup → week 0's scored range opens Tue, so effectiveStart ≠ wkStart.
    const tuesday = buildWeeks(
      '2026-06-02',
      '2026-06-15',
      1,
      'UTC',
      [habit('d1', 'asset', 'daily', '2026-06-02T00:00:00Z')],
      [],
    );
    expect(tuesday.complete[0].positions.find((p) => p.habitId === 'd1')?.fullWeek).toBe(false);
  });

  it('the in-progress week is never full-week eligible', () => {
    const { current } = buildWeeks(
      '2026-06-01',
      '2026-06-03',
      1,
      'UTC',
      [habit('d1', 'asset', 'daily', '2026-06-01T00:00:00Z')],
      [],
    );
    expect(current?.positions.find((p) => p.habitId === 'd1')?.fullWeek).toBe(false);
  });
});

describe('buildWeeks — per-day roles keep target === scheduled', () => {
  it('every position now scores per-day, so target === scheduled', () => {
    const habits = [
      habit('m1', 'asset', 'morning', '2026-06-01T00:00:00Z'),
      habit('e1', 'asset', 'evening', '2026-06-01T00:00:00Z'),
      habit('mi1', 'asset', 'mission', '2026-06-01T00:00:00Z'),
      habit('v1', 'liability', null, '2026-06-01T00:00:00Z'),
    ];
    const { complete } = buildWeeks('2026-06-01', '2026-06-15', 1, 'UTC', habits, []);
    for (const p of complete[0].positions) {
      expect(p.target).toBe(p.scheduled);
    }
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

describe('buildWeeks — settlement grace window (settle the day AFTER the week ends)', () => {
  // Week 0 = Mon 06-01 .. Sun 06-07. With SETTLEMENT_GRACE_DAYS = 1 it settles only
  // once the local date passes Monday 06-08 — i.e. on Tuesday 06-09. Monday is the
  // grace day: last week stays editable + provisional while the new week runs live.
  const habits = [habit('d1', 'asset', 'daily', '2026-06-01T00:00:00Z')];

  it('on Sunday (the week-end itself) the week is still in progress, never pending', () => {
    const { complete, pending, current } = buildWeeks('2026-06-01', '2026-06-07', 1, 'UTC', habits, []);
    expect(complete).toHaveLength(0);
    expect(pending).toBeNull();
    expect(current?.weekIndex).toBe(0);
  });

  it('on the grace day (Mon 06-08) the just-closed week is PENDING, not complete', () => {
    const { complete, pending, current } = buildWeeks('2026-06-01', '2026-06-08', 1, 'UTC', habits, []);
    expect(complete).toHaveLength(0); // not settled/frozen yet — still fixable
    expect(pending?.weekIndex).toBe(0);
    expect(pending?.daysInWeek).toBe(7); // scored as a full week...
    expect(pending?.positions.find((p) => p.habitId === 'd1')?.fullWeek).toBe(true);
    expect(current?.weekIndex).toBe(1); // ...while the NEW week runs live beside it (Option B)
  });

  it('the day after the grace day (Tue 06-09) the week is COMPLETE (settles + freezes)', () => {
    const { complete, pending } = buildWeeks('2026-06-01', '2026-06-09', 1, 'UTC', habits, []);
    expect(complete.map((w) => w.weekIndex)).toEqual([0]);
    expect(pending).toBeNull();
  });
});

describe('buildWeeks — materializeFrom bounds the window WITHOUT changing results', () => {
  // The trailing-window optimization (perf #8): weeks whose end precedes the cutoff
  // are not built, but every week that IS built must be byte-identical to the
  // unbounded build — including its signup-based weekIndex. This is the
  // settlement-correctness backstop for the read-bounding in runner.ts.
  const habits = [
    habit('d1', 'asset', 'daily', '2026-06-01T00:00:00Z'),
    habit('v1', 'liability', null, '2026-06-01T00:00:00Z'),
  ];
  const logs = [
    log('d1', 'done', '2026-06-02'),
    log('d1', 'done', '2026-06-09'),
    log('v1', 'done', '2026-06-16'),
    log('d1', 'done', '2026-06-23'),
  ];

  it('retained weeks (and their indices/positions) match the unbounded build exactly', () => {
    // Signup Mon 06-01, today Thu 06-25 → weeks 0/1/2 complete, week 3 current.
    const full = buildWeeks('2026-06-01', '2026-06-25', 1, 'UTC', habits, logs);
    const bounded = buildWeeks('2026-06-01', '2026-06-25', 1, 'UTC', habits, logs, '2026-06-15');

    // The live + grace weeks are always materialized and unchanged.
    expect(bounded.current).toEqual(full.current);
    expect(bounded.pending).toEqual(full.pending);
    // complete is just the unbounded set filtered to the trailing window — each
    // retained week identical, indices preserved (2, not renumbered to 0).
    expect(bounded.complete).toEqual(full.complete.filter((w) => w.weekEnd >= '2026-06-15'));
    expect(full.complete.map((w) => w.weekIndex)).toEqual([0, 1, 2]);
    expect(bounded.complete.map((w) => w.weekIndex)).toEqual([2]);
  });

  it('a cutoff behind the pending week still surfaces that pending week (grace day)', () => {
    // Grace day Mon 06-08 → week 0 pending, week 1 current. Cutoff at signup keeps both.
    const full = buildWeeks('2026-06-01', '2026-06-08', 1, 'UTC', habits, logs);
    const bounded = buildWeeks('2026-06-01', '2026-06-08', 1, 'UTC', habits, logs, '2026-06-01');
    expect(bounded.pending).toEqual(full.pending);
    expect(bounded.current).toEqual(full.current);
    expect(bounded.pending?.weekIndex).toBe(0);
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

  it('a fully-UNPAID complete week still books a vices collapse (the single vice)', () => {
    const habits = [
      habit('v1', 'liability', null, '2026-06-01T00:00:00Z'),
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

describe('buildWeeks — as-of-week-END roster membership (0033)', () => {
  // Week 0 = Mon 2026-06-01 .. Sun 2026-06-07 (wkEnd). Today 2026-06-10 → week 0 complete.
  it('a vice archived AFTER week-end still participates (closes the archive-to-dodge hole)', () => {
    const habits = [
      habit('v1', 'liability', null, '2026-06-01T00:00:00Z', {
        status: 'retired',
        archived_at: '2026-06-08T00:00:00Z', // Monday, strictly after Sunday wkEnd
      }),
    ];
    const { complete } = buildWeeks('2026-06-01', '2026-06-10', 1, 'UTC', habits, []);
    expect(complete[0].positions.find((p) => p.habitId === 'v1')).toBeDefined();
    expect(isVicesCollapse(complete[0])).toBe(true); // fully-unpaid → still collapses
  });

  it('a habit archived MID-week is excluded from that week', () => {
    const habits = [
      habit('v1', 'liability', null, '2026-06-01T00:00:00Z', {
        status: 'retired',
        archived_at: '2026-06-04T00:00:00Z', // Thursday, on/before wkEnd → legit mid-week retire
      }),
    ];
    const { complete } = buildWeeks('2026-06-01', '2026-06-10', 1, 'UTC', habits, []);
    expect(complete[0].positions.find((p) => p.habitId === 'v1')).toBeUndefined();
  });

  it('graduate path behaves the same (graduated_at after week-end → still participates)', () => {
    const habits = [
      habit('d1', 'asset', 'daily', '2026-06-01T00:00:00Z', {
        status: 'graduated',
        graduated_at: '2026-06-09T00:00:00Z', // after wkEnd
      }),
    ];
    const logs = ['2026-06-01', '2026-06-02'].map((d) => log('d1', 'done', d));
    const { complete } = buildWeeks('2026-06-01', '2026-06-10', 1, 'UTC', habits, logs);
    expect(complete[0].positions.find((p) => p.habitId === 'd1')).toBeDefined();
  });

  it('an archived-today habit drops from the ongoing (current) week', () => {
    // Today 2026-06-10 is in week 1 (Mon 2026-06-08 .. Sun 2026-06-14). Archived today
    // (on/before that wkEnd) → excluded from the live provisional.
    const habits = [
      habit('d1', 'asset', 'daily', '2026-06-08T00:00:00Z', {
        status: 'retired',
        archived_at: '2026-06-10T00:00:00Z',
      }),
    ];
    const { current } = buildWeeks('2026-06-01', '2026-06-10', 1, 'UTC', habits, []);
    expect(current?.positions.find((p) => p.habitId === 'd1')).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import { dayOfTerm, daysClean, inferredViceSlipDates } from '../positions';

describe('dayOfTerm', () => {
  it('is null without a term', () => {
    expect(dayOfTerm(null, 14, '2026-06-10')).toBeNull();
    expect(dayOfTerm('2026-06-01', null, '2026-06-10')).toBeNull();
  });

  it('is day 1 on the start date', () => {
    expect(dayOfTerm('2026-06-10', 14, '2026-06-10')).toBe(1);
  });

  it('counts elapsed days (1-based)', () => {
    expect(dayOfTerm('2026-06-01', 14, '2026-06-10')).toBe(10);
  });

  it('clamps to [1, termDays]', () => {
    // past the term → clamp to the term length
    expect(dayOfTerm('2026-06-01', 7, '2026-06-30')).toBe(7);
    // before the start (shouldn't happen) → clamp up to 1
    expect(dayOfTerm('2026-06-10', 14, '2026-06-01')).toBe(1);
  });
});

describe('daysClean', () => {
  it('counts from the start date when never relapsed', () => {
    expect(daysClean([], '2026-06-01', '2026-06-08')).toBe(7);
  });

  it('is 0 when relapsed today', () => {
    expect(daysClean(['2026-06-08'], '2026-06-01', '2026-06-08')).toBe(0);
  });

  it('counts whole days since the most recent relapse', () => {
    expect(daysClean(['2026-06-02', '2026-06-05'], '2026-06-01', '2026-06-08')).toBe(3);
  });

  it('ignores future-dated relapses', () => {
    expect(daysClean(['2026-06-20'], '2026-06-01', '2026-06-08')).toBe(7);
  });
});

describe('inferredViceSlipDates', () => {
  it('an un-marked vice slips on every ELAPSED day, never today', () => {
    // start 06-01, today 06-04 → elapsed 06-01/02/03 are slips; 06-04 (today) is not.
    expect(inferredViceSlipDates([], '2026-06-01', '2026-06-04')).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
    ]);
  });

  it('only the days missing a paid (done) log count as slips', () => {
    // paid 06-01 and 06-03; 06-02 is the lone elapsed gap.
    expect(
      inferredViceSlipDates(['2026-06-01', '2026-06-03'], '2026-06-01', '2026-06-04'),
    ).toEqual(['2026-06-02']);
  });

  it('today un-marked is NOT a slip (clean run keeps counting up)', () => {
    // Paid every elapsed day, today (06-04) blank → no slips, daysClean = 3.
    const slips = inferredViceSlipDates(
      ['2026-06-01', '2026-06-02', '2026-06-03'],
      '2026-06-01',
      '2026-06-04',
    );
    expect(slips).toEqual([]);
    expect(daysClean(slips, '2026-06-01', '2026-06-04')).toBe(3);
  });

  it('a slipped elapsed day resets the clean run at that day', () => {
    // Missed 06-02 → that is the most recent slip; daysClean from 06-02 to 06-04 = 2.
    const slips = inferredViceSlipDates(['2026-06-01', '2026-06-03'], '2026-06-01', '2026-06-04');
    expect(daysClean(slips, '2026-06-01', '2026-06-04')).toBe(2);
  });

  it('a vice created today has no elapsed days, so no slips', () => {
    expect(inferredViceSlipDates([], '2026-06-04', '2026-06-04')).toEqual([]);
  });
});

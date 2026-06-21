import { describe, it, expect } from 'vitest';
import {
  dayOfTerm,
  daysDoneInTerm,
  sparklineSeries,
  daysClean,
  inferredViceSlipDates,
} from '../positions';

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

describe('daysDoneInTerm', () => {
  it('is null when the term has not started', () => {
    expect(daysDoneInTerm(['2026-06-02'], null, '2026-06-10')).toBeNull();
  });

  it('counts distinct done days inside [start..today]', () => {
    expect(
      daysDoneInTerm(['2026-06-01', '2026-06-03', '2026-06-05'], '2026-06-01', '2026-06-10'),
    ).toBe(3);
  });

  it('excludes done days before the term start and after today', () => {
    expect(
      daysDoneInTerm(['2026-05-30', '2026-06-02', '2026-06-20'], '2026-06-01', '2026-06-10'),
    ).toBe(1);
  });

  it('de-duplicates a day logged more than once', () => {
    expect(daysDoneInTerm(['2026-06-02', '2026-06-02'], '2026-06-01', '2026-06-10')).toBe(1);
  });

  it('is 0 when nothing done yet in the term', () => {
    expect(daysDoneInTerm([], '2026-06-01', '2026-06-10')).toBe(0);
  });
});

describe('sparklineSeries', () => {
  it('appends today (live) to history, sorted chronologically', () => {
    const hist = [
      { date: '2026-06-08', cents: 100 },
      { date: '2026-06-09', cents: 200 },
    ];
    expect(sparklineSeries(hist, '2026-06-10', 300)).toEqual([100, 200, 300]);
  });

  it('overrides a stale stored today with the live value', () => {
    const hist = [
      { date: '2026-06-09', cents: 200 },
      { date: '2026-06-10', cents: 250 }, // stale earlier-in-day snapshot
    ];
    expect(sparklineSeries(hist, '2026-06-10', 400)).toEqual([200, 400]);
  });

  it('keeps only the last maxPoints values', () => {
    const hist = Array.from({ length: 9 }, (_, i) => ({
      date: `2026-06-0${i + 1}`,
      cents: i,
    }));
    // 9 history days + today (override of 06-09 if present? dates are 01..09) + today 06-10
    const out = sparklineSeries(hist, '2026-06-10', 99, 7);
    expect(out).toHaveLength(7);
    expect(out[out.length - 1]).toBe(99); // today last
  });

  it('returns a single point when only today is known', () => {
    expect(sparklineSeries([], '2026-06-10', 500)).toEqual([500]);
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

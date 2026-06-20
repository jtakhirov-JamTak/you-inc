import { describe, it, expect } from 'vitest';
import { dayOfTerm, daysClean } from '../positions';

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

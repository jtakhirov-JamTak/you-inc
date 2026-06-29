import { describe, it, expect } from 'vitest';
import {
  addDays,
  addYears,
  dayOfWeek,
  diffDays,
  localDateInTz,
  weekStartOf,
} from '../dates';

describe('local-date arithmetic', () => {
  it('addDays crosses month/year boundaries', () => {
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('addYears advances one calendar year (year-goal due date)', () => {
    expect(addYears('2026-06-22', 1)).toBe('2027-06-22');
    expect(addYears('2026-12-31', 1)).toBe('2027-12-31');
    expect(addYears('2026-01-01', 1)).toBe('2027-01-01');
  });

  it('addYears clamps Feb 29 to Feb 28 in a non-leap target year', () => {
    // 2028 is a leap year; +1 → 2029 (non-leap) clamps to Feb 28.
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
    // Leap → leap keeps the 29th.
    expect(addYears('2024-02-29', 4)).toBe('2028-02-29');
  });

  it('dayOfWeek: 0=Sun..6=Sat', () => {
    expect(dayOfWeek('2026-06-21')).toBe(0); // Sunday
    expect(dayOfWeek('2026-06-22')).toBe(1); // Monday
  });

  it('diffDays', () => {
    expect(diffDays('2026-06-22', '2026-06-15')).toBe(7);
    expect(diffDays('2026-06-15', '2026-06-22')).toBe(-7);
  });

  it('weekStartOf snaps back to the configured start day', () => {
    // Friday 2026-06-19, week starts Monday(1) → Monday 2026-06-15.
    const ws = weekStartOf('2026-06-19', 1);
    expect(dayOfWeek(ws)).toBe(1);
    expect(diffDays('2026-06-19', ws)).toBe(4);
    // Sunday start(0).
    const ws0 = weekStartOf('2026-06-19', 0);
    expect(dayOfWeek(ws0)).toBe(0);
  });

  it('localDateInTz is DST/zone correct', () => {
    // 02:00 UTC is the previous evening in New York.
    expect(localDateInTz(new Date('2026-06-19T02:00:00Z'), 'America/New_York')).toBe('2026-06-18');
    expect(localDateInTz(new Date('2026-06-19T02:00:00Z'), 'UTC')).toBe('2026-06-19');
    expect(localDateInTz(new Date('2026-06-19T12:00:00Z'), 'Asia/Tokyo')).toBe('2026-06-19');
  });
});

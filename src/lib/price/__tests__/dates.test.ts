import { describe, it, expect } from 'vitest';
import {
  addDays,
  dayOfWeek,
  diffDays,
  localDateInTz,
  weekStartOf,
} from '../dates';
import { scheduledOccurrences } from '../recurrence';

describe('local-date arithmetic', () => {
  it('addDays crosses month/year boundaries', () => {
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
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

describe('recurrence — scheduled occurrences per week', () => {
  it('weekdays', () => {
    // Mon–Sun week, Mon/Wed/Fri → 3.
    expect(
      scheduledOccurrences({ type: 'weekdays', days: [1, 3, 5] }, '2026-06-15', '2026-06-21'),
    ).toBe(3);
    // Weekends only.
    expect(
      scheduledOccurrences({ type: 'weekdays', days: [0, 6] }, '2026-06-15', '2026-06-21'),
    ).toBe(2);
  });

  it('every_n_days counts on/after the anchor', () => {
    // n=3 from 06-01 across 06-01..06-07 → 06-01, 06-04, 06-07 = 3.
    expect(
      scheduledOccurrences({ type: 'every_n_days', n: 3, anchor: '2026-06-01' }, '2026-06-01', '2026-06-07'),
    ).toBe(3);
    // Range before the anchor → 0.
    expect(
      scheduledOccurrences({ type: 'every_n_days', n: 3, anchor: '2026-06-10' }, '2026-06-01', '2026-06-07'),
    ).toBe(0);
  });

  it('empty / inverted ranges → 0', () => {
    expect(scheduledOccurrences({ type: 'weekdays', days: [1] }, '2026-06-21', '2026-06-15')).toBe(0);
  });
});

// isScheduledOn drives the Habits check-in UI (a weekly habit is only markable on
// its scheduled days) AND, via scheduledOccurrences, the weekly scoring divisor —
// so pin both the per-day predicate and that the range count stays consistent with it.

import { describe, it, expect } from "vitest";
import { isScheduledOn, scheduledOccurrences, type RecurrenceRule } from "@/lib/price/recurrence";

// 2026-06-15 is a Monday → 06-21 Sunday (the founder's current week).
const MON = "2026-06-15";
const THU = "2026-06-18";
const SAT = "2026-06-20";
const SUN = "2026-06-21";

describe("isScheduledOn — weekdays", () => {
  const rule: RecurrenceRule = { type: "weekdays", days: [1, 4, 6] }; // Mon/Thu/Sat

  it("is true on a scheduled weekday", () => {
    expect(isScheduledOn(rule, MON)).toBe(true);
    expect(isScheduledOn(rule, THU)).toBe(true);
    expect(isScheduledOn(rule, SAT)).toBe(true);
  });

  it("is false on a non-scheduled weekday (Sunday)", () => {
    expect(isScheduledOn(rule, SUN)).toBe(false);
    expect(isScheduledOn(rule, "2026-06-16")).toBe(false); // Tue
  });
});

describe("isScheduledOn — every_n_days", () => {
  const rule: RecurrenceRule = { type: "every_n_days", n: 3, anchor: MON };

  it("is true on the anchor and every nth day after", () => {
    expect(isScheduledOn(rule, MON)).toBe(true); // delta 0
    expect(isScheduledOn(rule, THU)).toBe(true); // delta 3
  });

  it("is false off-cycle and before the anchor", () => {
    expect(isScheduledOn(rule, "2026-06-16")).toBe(false); // delta 1
    expect(isScheduledOn(rule, "2026-06-14")).toBe(false); // before anchor
  });

  it("never schedules when n <= 0 (defensive)", () => {
    expect(isScheduledOn({ type: "every_n_days", n: 0, anchor: MON }, MON)).toBe(false);
  });
});

describe("scheduledOccurrences stays consistent with isScheduledOn", () => {
  it("counts exactly the days the predicate marks scheduled", () => {
    const rule: RecurrenceRule = { type: "weekdays", days: [1, 4, 6] };
    // Mon 06-15 .. Sun 06-21 → Mon, Thu, Sat = 3
    expect(scheduledOccurrences(rule, MON, SUN)).toBe(3);
  });
});

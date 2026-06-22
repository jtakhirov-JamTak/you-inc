// Cross-field / refine coverage for the validation schemas. The simple field
// bounds are exercised in habit-validation.test.ts and board-validation.test.ts;
// THIS file pins the object-level refinements that can silently invert without a
// test — the only thing standing between malformed client input and the engine's
// date/roster assumptions (test-audit, full-audit 2026-06-22).

import { describe, it, expect } from "vitest";
import {
  createSprintSchema,
  createHabitSchema,
  recurrenceInputSchema,
  saveIdentitySchema,
  saveYearGoalSchema,
  habitLogSchema,
  updateTimezoneSchema,
} from "@/lib/validation";

const UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("createSprintSchema — task milestone must fall within the term", () => {
  const base = {
    size: "small" as const,
    area: "health" as const,
    thesis: "Ship the thing",
    termDays: 10,
  };
  it("accepts tasks whose dueDay ≤ termDays (boundary included)", () => {
    expect(
      createSprintSchema.safeParse({
        ...base,
        termDays: 14,
        tasks: [{ title: "A", dueDay: 1 }, { title: "B", dueDay: 14 }],
      }).success,
    ).toBe(true);
  });
  it("rejects a task milestone past the term end", () => {
    expect(
      createSprintSchema.safeParse({
        ...base,
        termDays: 10,
        tasks: [{ title: "A", dueDay: 12 }],
      }).success,
    ).toBe(false);
  });
});

describe("createHabitSchema — weekly requires recurrence; others must not carry one", () => {
  it("accepts a weekly asset WITH a recurrence", () => {
    expect(
      createHabitSchema.safeParse({
        kind: "asset",
        cadence: "weekly",
        title: "Long run",
        termDays: 30,
        recurrence: { type: "every_n_days", n: 7 },
      }).success,
    ).toBe(true);
  });
  it("rejects a weekly asset WITHOUT a recurrence", () => {
    expect(
      createHabitSchema.safeParse({
        kind: "asset",
        cadence: "weekly",
        title: "Long run",
        termDays: 30,
      }).success,
    ).toBe(false);
  });
  it("accepts morning/daily WITHOUT a recurrence", () => {
    expect(
      createHabitSchema.safeParse({
        kind: "asset",
        cadence: "daily",
        title: "Read",
        termDays: 30,
      }).success,
    ).toBe(true);
  });
  it("rejects morning/daily that carry a recurrence", () => {
    expect(
      createHabitSchema.safeParse({
        kind: "asset",
        cadence: "morning",
        title: "Meditate",
        termDays: 30,
        recurrence: { type: "weekdays", days: [1, 3, 5] },
      }).success,
    ).toBe(false);
  });
  it("accepts a liability with just a title", () => {
    expect(
      createHabitSchema.safeParse({ kind: "liability", title: "Doomscroll" }).success,
    ).toBe(true);
  });
});

describe("recurrenceInputSchema — ≥1 occurrence/week guarantees", () => {
  it("accepts distinct weekdays and rejects duplicates", () => {
    expect(recurrenceInputSchema.safeParse({ type: "weekdays", days: [1, 4, 6] }).success).toBe(true);
    expect(recurrenceInputSchema.safeParse({ type: "weekdays", days: [1, 1] }).success).toBe(false);
  });
  it("rejects an empty weekday list and out-of-range days", () => {
    expect(recurrenceInputSchema.safeParse({ type: "weekdays", days: [] }).success).toBe(false);
    expect(recurrenceInputSchema.safeParse({ type: "weekdays", days: [7] }).success).toBe(false);
  });
  it("bounds every_n_days to 1..7 (so a week always has ≥1)", () => {
    expect(recurrenceInputSchema.safeParse({ type: "every_n_days", n: 1 }).success).toBe(true);
    expect(recurrenceInputSchema.safeParse({ type: "every_n_days", n: 7 }).success).toBe(true);
    expect(recurrenceInputSchema.safeParse({ type: "every_n_days", n: 8 }).success).toBe(false);
    expect(recurrenceInputSchema.safeParse({ type: "every_n_days", n: 0 }).success).toBe(false);
  });
});

describe("saveIdentitySchema — exactly-3 values/modes, no duplicates, ≤1 affirmation", () => {
  const values = [1, 2, 3].map((position) => ({ position, title: `V${position}`, meaning: "x" }));
  const modes = (["baseline", "close_people", "under_pressure"] as const).map((mode_key) => ({
    mode_key,
    mode_name: "name",
    description: "desc",
  }));
  it("accepts a complete, distinct charter", () => {
    expect(saveIdentitySchema.safeParse({ values, modes, affirmations: [] }).success).toBe(true);
  });
  it("rejects fewer/more than 3 values", () => {
    expect(saveIdentitySchema.safeParse({ values: values.slice(0, 2), modes, affirmations: [] }).success).toBe(false);
  });
  it("rejects duplicate value positions", () => {
    const dup = [
      { position: 1 as const, title: "A", meaning: "x" },
      { position: 1 as const, title: "B", meaning: "y" },
      { position: 3 as const, title: "C", meaning: "z" },
    ];
    expect(saveIdentitySchema.safeParse({ values: dup, modes, affirmations: [] }).success).toBe(false);
  });
  it("rejects duplicate mode keys", () => {
    const dupModes = [modes[0], modes[0], modes[2]];
    expect(saveIdentitySchema.safeParse({ values, modes: dupModes, affirmations: [] }).success).toBe(false);
  });
  it("rejects more than one affirmation", () => {
    const aff = { affirmation: "You are", visualization: "see it" };
    expect(saveIdentitySchema.safeParse({ values, modes, affirmations: [aff, aff] }).success).toBe(false);
  });
});

describe("strict calendar dates (calendarDate refine)", () => {
  it("rejects an impossible date and accepts a real one (habitLogSchema.localDate)", () => {
    const base = { habitId: UUID, occurredTz: "UTC", sourceSessionId: UUID };
    expect(habitLogSchema.safeParse({ ...base, localDate: "2026-02-30" }).success).toBe(false);
    expect(habitLogSchema.safeParse({ ...base, localDate: "2026-13-01" }).success).toBe(false);
    expect(habitLogSchema.safeParse({ ...base, localDate: "2026-02-28" }).success).toBe(true);
  });
  it("saveYearGoalSchema.targetDate: real date OR empty string, not garbage", () => {
    const base = { title: "Run a marathon", area: "health" as const };
    expect(saveYearGoalSchema.safeParse({ ...base, targetDate: "2026-12-31" }).success).toBe(true);
    expect(saveYearGoalSchema.safeParse({ ...base, targetDate: "" }).success).toBe(true);
    expect(saveYearGoalSchema.safeParse({ ...base, targetDate: "2026-02-30" }).success).toBe(false);
    expect(saveYearGoalSchema.safeParse({ ...base }).success).toBe(true);
  });
});

describe("updateTimezoneSchema — strict IANA validity", () => {
  it("accepts a real IANA zone", () => {
    expect(updateTimezoneSchema.safeParse({ timezone: "America/Los_Angeles" }).success).toBe(true);
    expect(updateTimezoneSchema.safeParse({ timezone: "UTC" }).success).toBe(true);
  });
  it("rejects a bogus zone (would throw in Intl and blank the home value)", () => {
    expect(updateTimezoneSchema.safeParse({ timezone: "Mars/Phobos" }).success).toBe(false);
    expect(updateTimezoneSchema.safeParse({ timezone: "" }).success).toBe(false);
  });
});

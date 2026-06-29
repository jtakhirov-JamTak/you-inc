// Habit edit/archive request schemas. These gate the PATCH/DELETE writes at the
// endpoint boundary — pin the bounds (partial patch, clearable area, term limits,
// bad UUIDs) so a loosened schema can't let a malformed update through.
// (Cross-field validity — term only for assets — is enforced in the handler against
// the fetched habit, not here.)

import { describe, it, expect } from "vitest";
import { updateHabitSchema, removeHabitSchema } from "@/lib/validation";

const UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("updateHabitSchema", () => {
  it("accepts a partial patch (any subset of editable fields)", () => {
    expect(updateHabitSchema.safeParse({ habitId: UUID, title: "Lift" }).success).toBe(true);
    expect(updateHabitSchema.safeParse({ habitId: UUID, termDays: 30 }).success).toBe(true);
  });

  it("allows clearing area with null but rejects an unknown area", () => {
    expect(updateHabitSchema.safeParse({ habitId: UUID, area: null }).success).toBe(true);
    expect(updateHabitSchema.safeParse({ habitId: UUID, area: "health" }).success).toBe(true);
    expect(updateHabitSchema.safeParse({ habitId: UUID, area: "money" }).success).toBe(false);
  });

  it("rejects a non-uuid id, an out-of-set term, and an empty title", () => {
    expect(updateHabitSchema.safeParse({ habitId: "nope", title: "x" }).success).toBe(false);
    expect(updateHabitSchema.safeParse({ habitId: UUID, termDays: 21 }).success).toBe(false);
    expect(updateHabitSchema.safeParse({ habitId: UUID, title: "   " }).success).toBe(false);
  });
});

describe("removeHabitSchema", () => {
  it("accepts a uuid and rejects anything else", () => {
    expect(removeHabitSchema.safeParse({ habitId: UUID }).success).toBe(true);
    expect(removeHabitSchema.safeParse({ habitId: "nope" }).success).toBe(false);
    expect(removeHabitSchema.safeParse({}).success).toBe(false);
  });
});

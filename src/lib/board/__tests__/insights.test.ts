// The deterministic insight engine is the source of truth for every number the
// Board analysis shows, so its evidence gating and weekday math are pinned here. A
// regression that fabricates a pattern (or misses a real one) directly erodes the
// feature's whole premise: being accurate about the user's own behavior.

import { describe, it, expect } from "vitest";
import { addDays, compareLocalDate, dayOfWeek, type LocalDate } from "@/lib/price/dates";
import { computeInsightFacts, type InsightInput, type InsightInputLog } from "@/lib/board/insights";

const START: LocalDate = "2026-05-01";
const END: LocalDate = addDays(START, 41); // 42-day (6-week) window

/** Every date in the window. */
function windowDates(): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = START; compareLocalDate(d, END) <= 0; d = addDays(d, 1)) out.push(d);
  return out;
}

function base(overrides: Partial<InsightInput> = {}): InsightInput {
  return {
    window: { startDate: START, endDate: END },
    habits: [],
    logs: [],
    closedSprintTasks: [],
    closedSprintCount: 0,
    weeklyDeltas: [],
    ...overrides,
  };
}

describe("computeInsightFacts — evidence gating", () => {
  it("returns 'insufficient' with no patterns when too few distinct days", () => {
    const habit = { id: "h1", title: "Walk", kind: "asset" as const, cadence: "daily", area: null, startLocal: START };
    // 4 done logs across 4 days — below MIN_DISTINCT_DAYS (5) and MIN_LOGS (6).
    const logs: InsightInputLog[] = windowDates()
      .slice(0, 4)
      .map((d) => ({ habitId: "h1", status: "done" as const, localDate: d }));
    const facts = computeInsightFacts(base({ habits: [habit], logs }));
    expect(facts.state).toBe("insufficient");
    expect(facts.topPatterns).toHaveLength(0);
  });

  it("returns 'insufficient' when no habits existed in the window", () => {
    const facts = computeInsightFacts(base());
    expect(facts.state).toBe("insufficient");
  });
});

describe("computeInsightFacts — weekday skip pattern", () => {
  it("surfaces the weekday a daily asset is skipped on", () => {
    const habit = { id: "h1", title: "Evening walk", kind: "asset" as const, cadence: "daily", area: null, startLocal: START };
    const THURSDAY = 4;
    // Done every day EXCEPT Thursdays → all misses land on Thursday.
    const logs: InsightInputLog[] = windowDates()
      .filter((d) => dayOfWeek(d) !== THURSDAY)
      .map((d) => ({ habitId: "h1", status: "done" as const, localDate: d }));
    const facts = computeInsightFacts(base({ habits: [habit], logs }));

    const skip = facts.topPatterns.find((p) => p.kind === "habit_skip");
    expect(skip).toBeTruthy();
    expect(skip!.facts.worstWeekday).toBe("Thursday");
    expect(skip!.facts.habit).toBe("Evening walk");
    expect(skip!.direction).toBe("negative");
  });

  it("does NOT call a single missed day a pattern", () => {
    const habit = { id: "h1", title: "Walk", kind: "asset" as const, cadence: "daily", area: null, startLocal: START };
    const dates = windowDates();
    // Done every day except ONE → missed=1, below MIN_MISSES_FOR_PATTERN.
    const logs: InsightInputLog[] = dates
      .slice(1)
      .map((d) => ({ habitId: "h1", status: "done" as const, localDate: d }));
    const facts = computeInsightFacts(base({ habits: [habit], logs }));
    expect(facts.topPatterns.find((p) => p.kind === "habit_skip")).toBeFalsy();
  });
});

describe("computeInsightFacts — vices and bright spots", () => {
  it("surfaces a vice's relapse weekday and a strong habit together", () => {
    const asset = { id: "a1", title: "Read", kind: "asset" as const, cadence: "daily", area: null, startLocal: START };
    const vice = { id: "v1", title: "Doomscroll", kind: "liability" as const, cadence: null, area: null, startLocal: START };
    const MONDAY = 1;
    const dates = windowDates();
    const assetLogs: InsightInputLog[] = dates.map((d) => ({ habitId: "a1", status: "done" as const, localDate: d }));
    const viceLogs: InsightInputLog[] = dates
      .filter((d) => dayOfWeek(d) === MONDAY)
      .map((d) => ({ habitId: "v1", status: "relapse" as const, localDate: d }));

    const facts = computeInsightFacts(base({ habits: [asset, vice], logs: [...assetLogs, ...viceLogs] }));

    const relapse = facts.topPatterns.find((p) => p.kind === "vice_relapse");
    const strong = facts.topPatterns.find((p) => p.kind === "habit_strong");
    expect(relapse).toBeTruthy();
    expect(relapse!.facts.worstWeekday).toBe("Monday");
    expect(strong).toBeTruthy();
    expect(strong!.facts.habit).toBe("Read");
  });

  it("emits no weekday skip pattern for a weekly asset", () => {
    const weekly = { id: "w1", title: "Sunday plan", kind: "asset" as const, cadence: "weekly", area: null, startLocal: START };
    const daily = { id: "d1", title: "Walk", kind: "asset" as const, cadence: "daily", area: null, startLocal: START };
    // Clear thresholds with the daily habit; the weekly is never completed.
    const logs: InsightInputLog[] = windowDates().map((d) => ({ habitId: "d1", status: "done" as const, localDate: d }));
    const facts = computeInsightFacts(base({ habits: [weekly, daily], logs }));
    // No habit_skip should reference the weekly habit (it carries no weekday).
    const weeklySkip = facts.topPatterns.find((p) => p.kind === "habit_skip" && p.facts.habit === "Sunday plan");
    expect(weeklySkip).toBeFalsy();
  });
});

describe("computeInsightFacts — selection", () => {
  it("caps the surfaced patterns at three", () => {
    const asset = { id: "a1", title: "Read", kind: "asset" as const, cadence: "daily", area: null, startLocal: START };
    const vice = { id: "v1", title: "Doomscroll", kind: "liability" as const, cadence: null, area: null, startLocal: START };
    const MONDAY = 1;
    const dates = windowDates();
    const assetLogs: InsightInputLog[] = dates.map((d) => ({ habitId: "a1", status: "done" as const, localDate: d }));
    const viceLogs: InsightInputLog[] = dates
      .filter((d) => dayOfWeek(d) === MONDAY)
      .map((d) => ({ habitId: "v1", status: "relapse" as const, localDate: d }));

    const facts = computeInsightFacts(
      base({
        habits: [asset, vice],
        logs: [...assetLogs, ...viceLogs],
        closedSprintTasks: [{ done: true }, { done: true }, { done: false }],
        closedSprintCount: 1,
        weeklyDeltas: [
          { weekIndex: 1, deltaCents: 1000 },
          { weekIndex: 2, deltaCents: -500 },
        ],
      }),
    );
    expect(facts.topPatterns.length).toBeLessThanOrEqual(3);
    expect(facts.topPatterns.length).toBeGreaterThan(0);
  });
});

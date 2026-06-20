// The deterministic insight engine is the source of truth for every number the
// Board analysis shows, so its evidence gating and weekday math are pinned here. A
// regression that fabricates a pattern (or misses a real one) directly erodes the
// feature's whole premise: being accurate about the user's own behavior.

import { describe, it, expect } from "vitest";
import { addDays, compareLocalDate, dayOfWeek, type LocalDate } from "@/lib/price/dates";
import {
  computeInsightFacts,
  type InsightInput,
  type InsightInputHabit,
  type InsightInputLog,
} from "@/lib/board/insights";

const START: LocalDate = "2026-05-01";
const END: LocalDate = addDays(START, 41); // 42-day (6-week) window

/** Every date in the window. */
function windowDates(): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = START; compareLocalDate(d, END) <= 0; d = addDays(d, 1)) out.push(d);
  return out;
}

/** A habit with sensible defaults (active, daily asset, present the whole window). */
function habit(over: Partial<InsightInputHabit> & { id: string }): InsightInputHabit {
  return {
    title: "Habit",
    kind: "asset",
    cadence: "daily",
    area: null,
    status: "active",
    startLocal: START,
    ...over,
  };
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
    // 4 done logs across 4 days — below MIN_DISTINCT_DAYS (5) and MIN_LOGS (6).
    const logs: InsightInputLog[] = windowDates()
      .slice(0, 4)
      .map((d) => ({ habitId: "h1", status: "done" as const, localDate: d }));
    const facts = computeInsightFacts(base({ habits: [habit({ id: "h1", title: "Walk" })], logs }));
    expect(facts.state).toBe("insufficient");
    expect(facts.topPatterns).toHaveLength(0);
  });

  it("returns 'insufficient' when no habits existed in the window", () => {
    const facts = computeInsightFacts(base());
    expect(facts.state).toBe("insufficient");
  });
});

describe("computeInsightFacts — roster scoping", () => {
  it("does NOT score a non-active (graduated/retired) habit", () => {
    // A retired habit with no logs in the window must never surface as "skipped" —
    // the whole point: don't fabricate a pattern about a habit the user stopped.
    const retired = habit({ id: "r1", title: "Cold showers", status: "graduated" });
    const active = habit({ id: "a1", title: "Read" });
    // Clear the global gate with the active habit so the retired one COULD surface
    // if it weren't filtered.
    const logs: InsightInputLog[] = windowDates().map((d) => ({
      habitId: "a1",
      status: "done" as const,
      localDate: d,
    }));
    const facts = computeInsightFacts(base({ habits: [retired, active], logs }));
    expect(facts.evidence.activeHabits).toBe(1);
    expect(facts.topPatterns.find((p) => p.facts.habit === "Cold showers")).toBeFalsy();
  });

  it("does NOT make a confident claim about a habit with < 2 weeks of its own history", () => {
    // A habit created 8 days before window end, done all 8 days, must not surface as
    // an "established" bright spot just because another habit cleared the global gate.
    const fresh = habit({ id: "f1", title: "New habit", startLocal: addDays(END, -7) });
    const old = habit({ id: "o1", title: "Read" });
    const freshLogs: InsightInputLog[] = windowDates()
      .filter((d) => compareLocalDate(d, addDays(END, -7)) >= 0)
      .map((d) => ({ habitId: "f1", status: "done" as const, localDate: d }));
    const oldLogs: InsightInputLog[] = windowDates().map((d) => ({ habitId: "o1", status: "done" as const, localDate: d }));
    const facts = computeInsightFacts(base({ habits: [fresh, old], logs: [...freshLogs, ...oldLogs] }));
    expect(facts.topPatterns.find((p) => p.facts.habit === "New habit")).toBeFalsy();
  });
});

describe("computeInsightFacts — weekday skip pattern", () => {
  it("surfaces the weekday a daily asset is skipped on", () => {
    const THURSDAY = 4;
    // Done every day EXCEPT Thursdays → all misses land on Thursday.
    const logs: InsightInputLog[] = windowDates()
      .filter((d) => dayOfWeek(d) !== THURSDAY)
      .map((d) => ({ habitId: "h1", status: "done" as const, localDate: d }));
    const facts = computeInsightFacts(base({ habits: [habit({ id: "h1", title: "Evening walk" })], logs }));

    const skip = facts.topPatterns.find((p) => p.kind === "habit_skip");
    expect(skip).toBeTruthy();
    expect(skip!.facts.worstWeekday).toBe("Thursday");
    expect(skip!.facts.habit).toBe("Evening walk");
    expect(skip!.direction).toBe("negative");
  });

  it("does NOT call a single missed day a pattern", () => {
    // Done every day except ONE → missed=1, below MIN_MISSES_FOR_PATTERN.
    const logs: InsightInputLog[] = windowDates()
      .slice(1)
      .map((d) => ({ habitId: "h1", status: "done" as const, localDate: d }));
    const facts = computeInsightFacts(base({ habits: [habit({ id: "h1", title: "Walk" })], logs }));
    expect(facts.topPatterns.find((p) => p.kind === "habit_skip")).toBeFalsy();
  });

  it("ranks the worst negative by TOTAL misses, not weekday concentration", () => {
    const MONDAY = 1;
    // A: skipped ~6× spread (one per week, never 2 on a weekday → no worstWeekday → not a candidate).
    // Make A skip heavily but evenly, B skip fewer but concentrated on Mondays.
    const dates = windowDates();
    // A "Spread": skip every Wed AND Fri (12 misses, worst weekday 6).
    const aLogs: InsightInputLog[] = dates
      .filter((d) => dayOfWeek(d) !== 3 && dayOfWeek(d) !== 5)
      .map((d) => ({ habitId: "A", status: "done" as const, localDate: d }));
    // B "Concentrated": skip only Mondays (6 misses, worst weekday 6).
    const bLogs: InsightInputLog[] = dates
      .filter((d) => dayOfWeek(d) !== MONDAY)
      .map((d) => ({ habitId: "B", status: "done" as const, localDate: d }));
    const facts = computeInsightFacts(
      base({
        habits: [habit({ id: "A", title: "Spread" }), habit({ id: "B", title: "Concentrated" })],
        logs: [...aLogs, ...bLogs],
      }),
    );
    const skip = facts.topPatterns.find((p) => p.kind === "habit_skip");
    // A has 12 misses vs B's 6 → A must be the surfaced negative.
    expect(skip!.facts.habit).toBe("Spread");
  });
});

describe("computeInsightFacts — vices and bright spots", () => {
  it("surfaces a vice's relapse weekday and a strong habit together", () => {
    const asset = habit({ id: "a1", title: "Read" });
    const vice = habit({ id: "v1", title: "Doomscroll", kind: "liability", cadence: null });
    const MONDAY = 1;
    const dates = windowDates();
    const assetLogs: InsightInputLog[] = dates.map((d) => ({ habitId: "a1", status: "done" as const, localDate: d }));
    // Vices are affirmative-only now: "paid" every day EXCEPT Mondays, so the
    // inferred slips (days with no 'done' log) all land on Mondays.
    const viceLogs: InsightInputLog[] = dates
      .filter((d) => dayOfWeek(d) !== MONDAY)
      .map((d) => ({ habitId: "v1", status: "done" as const, localDate: d }));

    const facts = computeInsightFacts(base({ habits: [asset, vice], logs: [...assetLogs, ...viceLogs] }));

    const relapse = facts.topPatterns.find((p) => p.kind === "vice_relapse");
    const strong = facts.topPatterns.find((p) => p.kind === "habit_strong");
    expect(relapse).toBeTruthy();
    expect(relapse!.facts.worstWeekday).toBe("Monday");
    expect(strong).toBeTruthy();
    expect(strong!.facts.habit).toBe("Read");
  });

  it("emits no weekday skip pattern for a weekly asset", () => {
    const weekly = habit({ id: "w1", title: "Sunday plan", cadence: "weekly" });
    const daily = habit({ id: "d1", title: "Walk" });
    // Clear thresholds with the daily habit; the weekly is never completed.
    const logs: InsightInputLog[] = windowDates().map((d) => ({ habitId: "d1", status: "done" as const, localDate: d }));
    const facts = computeInsightFacts(base({ habits: [weekly, daily], logs }));
    // No habit_skip or habit_strong should reference the weekly habit (no weekday signal).
    expect(facts.topPatterns.find((p) => p.facts.habit === "Sunday plan")).toBeFalsy();
  });
});

describe("computeInsightFacts — selection", () => {
  it("caps the surfaced patterns at three", () => {
    const asset = habit({ id: "a1", title: "Read" });
    const vice = habit({ id: "v1", title: "Doomscroll", kind: "liability", cadence: null });
    const MONDAY = 1;
    const dates = windowDates();
    const assetLogs: InsightInputLog[] = dates.map((d) => ({ habitId: "a1", status: "done" as const, localDate: d }));
    // Vices are affirmative-only now: "paid" every day EXCEPT Mondays, so the
    // inferred slips (days with no 'done' log) all land on Mondays.
    const viceLogs: InsightInputLog[] = dates
      .filter((d) => dayOfWeek(d) !== MONDAY)
      .map((d) => ({ habitId: "v1", status: "done" as const, localDate: d }));

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

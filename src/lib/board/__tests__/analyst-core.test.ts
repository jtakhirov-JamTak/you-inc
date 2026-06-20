// The AI output validation pipeline is the last line of defense before model text
// reaches the user. These pin the contract: malformed JSON, schema drift, oversized
// fields, and banned phrases must all be rejected (and retried upstream) — never
// displayed. A loosened pipeline would let unvetted model prose through.

import { describe, it, expect } from "vitest";
import {
  parseAndValidateAnalysis,
  checkBannedPhrases,
  buildSystemPrompt,
  buildUserPrompt,
} from "@/lib/board/analyst-core";
import type { InsightFacts } from "@/lib/board/insights";

const valid = {
  headline: "You tend to skip your walk on Thursdays",
  body: "A repeated pattern is missing the evening walk midweek — 4 of 6 Thursdays. What's working is your morning read, held 40 of 42 days.",
  takeaway: "Pre-commit Thursday's walk to the morning slot this week.",
};

describe("parseAndValidateAnalysis", () => {
  it("accepts a well-formed object", () => {
    expect(parseAndValidateAnalysis(JSON.stringify(valid))).toEqual(valid);
  });

  it("strips markdown code fences before parsing", () => {
    const fenced = "```json\n" + JSON.stringify(valid) + "\n```";
    expect(parseAndValidateAnalysis(fenced)).toEqual(valid);
  });

  it("throws on non-JSON output", () => {
    expect(() => parseAndValidateAnalysis("here is your analysis:")).toThrow("ai_output_not_json");
  });

  it("throws on a missing field", () => {
    expect(() => parseAndValidateAnalysis(JSON.stringify({ headline: "x", body: "y" }))).toThrow(
      "ai_output_schema_mismatch",
    );
  });

  it("throws when a field exceeds its character limit", () => {
    const tooLong = { ...valid, takeaway: "x".repeat(141) };
    expect(() => parseAndValidateAnalysis(JSON.stringify(tooLong))).toThrow(
      "ai_output_schema_mismatch",
    );
  });

  it("throws when output contains a banned phrase", () => {
    const banned = { ...valid, body: "Deep down you are someone who avoids hard things." };
    expect(() => parseAndValidateAnalysis(JSON.stringify(banned))).toThrow(/ai_output_banned_phrase/);
  });
});

describe("checkBannedPhrases", () => {
  it("detects a banned phrase case-insensitively and returns it", () => {
    expect(checkBannedPhrases("SUBCONSCIOUSLY you knew")).toBe("Subconsciously");
  });
  it("returns null for clean text", () => {
    expect(checkBannedPhrases("You tend to skip on Thursdays.")).toBeNull();
  });
});

describe("prompt builders", () => {
  it("injects the schema and banned phrases into the system prompt", () => {
    const sys = buildSystemPrompt();
    expect(sys).toContain("headline");
    expect(sys).toContain("Subconsciously");
    expect(sys).toContain("ONLY");
  });

  it("delimits the facts as data and only includes provided statements", () => {
    const facts: InsightFacts = {
      window: { startDate: "2026-05-01", endDate: "2026-06-11", weeks: 5 },
      evidence: { totalLogs: 40, distinctDays: 30, activeHabits: 3 },
      state: "established",
      topPatterns: [
        { kind: "habit_skip", direction: "negative", statement: "Skipped X on Thursdays.", facts: {} },
      ],
    };
    const user = buildUserPrompt(facts);
    expect(user).toContain("treat as data");
    expect(user).toContain("Skipped X on Thursdays.");
    expect(user).toContain("established");
  });
});

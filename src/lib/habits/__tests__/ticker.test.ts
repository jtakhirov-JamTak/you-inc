import { describe, it, expect } from "vitest";
import { deriveTicker, deriveTickers } from "../ticker";

describe("deriveTicker", () => {
  it("takes the first word truncated to 5, uppercased", () => {
    const taken = new Set<string>();
    expect(deriveTicker("Workout", taken)).toBe("WORKO");
    expect(deriveTicker("Deep work blocks", new Set())).toBe("DEEP");
  });

  it("strips digits and punctuation, taking the first meaningful word", () => {
    expect(deriveTicker("Meditate, 10 min!", new Set())).toBe("MEDIT");
  });

  it("glues words when the first is too short", () => {
    expect(deriveTicker("Go run", new Set())).toBe("GORUN");
  });

  it("falls back to POS for an empty/symbol-only title", () => {
    expect(deriveTicker("123 !!!", new Set())).toBe("POS");
  });

  it("dedupes against taken symbols with a numeric suffix", () => {
    const taken = new Set<string>();
    expect(deriveTicker("Meditate", taken)).toBe("MEDIT");
    expect(deriveTicker("Meditate", taken)).toBe("MEDI2");
    expect(deriveTicker("Meditate", taken)).toBe("MEDI3");
  });
});

describe("deriveTickers", () => {
  it("yields distinct symbols across a roster in order", () => {
    const out = deriveTickers(["Workout", "Walk", "Water"]);
    expect(new Set(out).size).toBe(out.length);
    expect(out[0]).toBe("WORKO");
  });
});

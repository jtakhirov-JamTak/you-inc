import { describe, it, expect } from "vitest";
import {
  validateRosterAddition,
  rosterStatus,
  MAX_LIABILITIES,
  type RosterSlot,
} from "../roster";

const asset = (cadence: RosterSlot["cadence"]): RosterSlot => ({ kind: "asset", cadence });
const vice = (): RosterSlot => ({ kind: "liability", cadence: null });

describe("validateRosterAddition", () => {
  it("allows the first asset of each cadence", () => {
    expect(validateRosterAddition([], asset("morning"))).toBeNull();
    expect(validateRosterAddition([asset("morning")], asset("evening"))).toBeNull();
    expect(
      validateRosterAddition([asset("morning"), asset("evening")], asset("mission")),
    ).toBeNull();
  });

  it("rejects a second asset of an already-filled cadence", () => {
    const err = validateRosterAddition([asset("morning")], asset("morning"));
    expect(err?.code).toBe("slot_taken");
  });

  it("requires a cadence on an asset", () => {
    const err = validateRosterAddition([], { kind: "asset", cadence: null });
    expect(err?.code).toBe("cadence_required");
  });

  it("allows up to MAX_LIABILITIES vices, then blocks", () => {
    expect(MAX_LIABILITIES).toBe(1);
    expect(validateRosterAddition([], vice())).toBeNull();
    const err = validateRosterAddition([vice()], vice());
    expect(err?.code).toBe("liabilities_full");
  });

  it("forbids a cadence on a liability", () => {
    const err = validateRosterAddition([], { kind: "liability", cadence: "morning" });
    expect(err?.code).toBe("cadence_forbidden");
  });

  it("counts only what is passed (caller passes ACTIVE habits)", () => {
    // A full roster blocks every kind of addition.
    const full = [asset("morning"), asset("evening"), asset("mission"), vice()];
    expect(validateRosterAddition(full, asset("morning"))?.code).toBe("slot_taken");
    expect(validateRosterAddition(full, vice())?.code).toBe("liabilities_full");
  });
});

describe("rosterStatus", () => {
  it("reports an empty roster as all-open, not complete", () => {
    const s = rosterStatus([]);
    expect(s.filledCadences).toEqual([]);
    expect(s.openCadences).toEqual(["morning", "evening", "mission"]);
    expect(s.liabilityCount).toBe(0);
    expect(s.liabilityOpen).toBe(MAX_LIABILITIES);
    expect(s.complete).toBe(false);
  });

  it("reports a full roster as complete with no open slots", () => {
    const s = rosterStatus([
      asset("morning"),
      asset("evening"),
      asset("mission"),
      vice(),
    ]);
    expect(s.openCadences).toEqual([]);
    expect(s.liabilityOpen).toBe(0);
    expect(s.complete).toBe(true);
  });

  it("reports partial fill correctly", () => {
    const s = rosterStatus([asset("evening"), vice()]);
    expect(s.filledCadences).toEqual(["evening"]);
    expect(s.openCadences).toEqual(["morning", "mission"]);
    expect(s.liabilityCount).toBe(1);
    expect(s.liabilityOpen).toBe(0);
    expect(s.complete).toBe(false);
  });
});

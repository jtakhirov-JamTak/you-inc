// Roster shape — the fixed balance-sheet shape (spec §"Asset roster"):
// exactly 3 asset habits (1 morning · 1 daily · 1 weekly) + 2 liabilities (vices).
//
// PURE (no I/O) so it's unit-testable and reused by both the create endpoint
// (enforce the cap) and the Habits page (show open/filled slots). The engine
// only clamps to WEEK_MAX *defensively*; this is the real gate that keeps the
// roster from drifting past the ±11 / −14.5% scoring envelope, so it MUST run at
// creation (M3 acceptance criterion).

export const ASSET_CADENCES = ["morning", "daily", "weekly"] as const;
export type Cadence = (typeof ASSET_CADENCES)[number];

export const MAX_LIABILITIES = 2;

export interface RosterSlot {
  kind: "asset" | "liability";
  cadence: Cadence | null;
}

export interface RosterError {
  code: "slot_taken" | "liabilities_full" | "cadence_required" | "cadence_forbidden";
  message: string;
}

/**
 * Can `proposed` be added to a roster that already holds `existing` (the user's
 * currently-ACTIVE habits only)? Returns the blocking error, or null if allowed.
 */
export function validateRosterAddition(
  existing: RosterSlot[],
  proposed: RosterSlot,
): RosterError | null {
  if (proposed.kind === "asset") {
    if (!proposed.cadence) {
      return { code: "cadence_required", message: "An asset needs a cadence." };
    }
    const taken = existing.some(
      (s) => s.kind === "asset" && s.cadence === proposed.cadence,
    );
    if (taken) {
      return {
        code: "slot_taken",
        message: `You already have a ${proposed.cadence} habit. Each cadence holds one.`,
      };
    }
    return null;
  }

  // liability
  if (proposed.cadence) {
    return { code: "cadence_forbidden", message: "A vice has no cadence." };
  }
  const count = existing.filter((s) => s.kind === "liability").length;
  if (count >= MAX_LIABILITIES) {
    return {
      code: "liabilities_full",
      message: `You can track ${MAX_LIABILITIES} vices to pay down.`,
    };
  }
  return null;
}

export interface RosterStatus {
  filledCadences: Cadence[];
  openCadences: Cadence[];
  liabilityCount: number;
  liabilityOpen: number;
  complete: boolean;
}

/** Which slots of the fixed shape are filled vs open, from the active roster. */
export function rosterStatus(existing: RosterSlot[]): RosterStatus {
  const filledCadences = ASSET_CADENCES.filter((c) =>
    existing.some((s) => s.kind === "asset" && s.cadence === c),
  );
  const openCadences = ASSET_CADENCES.filter((c) => !filledCadences.includes(c));
  const liabilityCount = existing.filter((s) => s.kind === "liability").length;
  const liabilityOpen = Math.max(MAX_LIABILITIES - liabilityCount, 0);
  return {
    filledCadences,
    openCadences,
    liabilityCount,
    liabilityOpen,
    complete: openCadences.length === 0 && liabilityOpen === 0,
  };
}

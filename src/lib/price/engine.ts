// You, Inc. — price engine: PURE, server-only settlement math.
//
// No I/O, no DB, no Date.now() — every function is a deterministic function of its
// inputs so it can be unit-tested and replayed. The settlement runner (separate,
// DB-aware) buckets a user's week from habit_logs, calls these, and
// books the results into price_ledger. Keep that orchestration OUT of this file.
//
// Percent inputs are whole percents (1.75 = 1.75%). Money is integer cents.

import {
  BASELINE_CENTS,
  DAILY_HABIT,
  SPRINT_GOAL_BONUS_PCT,
  SPRINT_PAYOFF_BANDS,
  VICE,
  WEEK_MAX,
  type SprintSize,
} from './config';

// ── Money helpers ───────────────────────────────────────────────────────────────

/** Round to the nearest integer, half away from zero (symmetric for +/−). */
export function roundHalfAwayFromZero(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n));
}

/** Convert a percent of a cents basis into integer cents (deterministic rounding). */
export function centsFromPct(pct: number, basisCents: number): number {
  return roundHalfAwayFromZero((basisCents * pct) / 100);
}

/** Clamp helper. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// ── Habit weekly settlement ─────────────────────────────────────────────────────
// A position's contribution for ONE settlement week, in percent. Inputs are already
// bucketed by the runner (counts of done/missed/clean/relapse occurrences).

export type PositionWeek =
  | { kind: 'vice'; cleanDays: number; relapseDays: number }
  | { kind: 'daily'; doneDays: number; missedDays: number }; // morning + evening + mission

/** Percent contribution of a single position for the week (each side capped). */
export function settlePositionPct(p: PositionWeek): number {
  switch (p.kind) {
    case 'vice': {
      const pos = Math.min(VICE.perCleanDay * p.cleanDays, VICE.weekCapPos);
      const neg = Math.max(-VICE.perRelapseDay * p.relapseDays, -VICE.weekCapNeg);
      return pos + neg;
    }
    case 'daily': {
      const pos = Math.min(DAILY_HABIT.perDoneDay * p.doneDays, DAILY_HABIT.weekCapPos);
      const neg = Math.max(-DAILY_HABIT.perMissDay * p.missedDays, -DAILY_HABIT.weekCapNeg);
      return pos + neg;
    }
  }
}

export interface HabitWeekResult {
  totalPct: number;
  totalCents: number;
  positions: Array<{ index: number; pct: number; cents: number }>;
}

/**
 * Settle the whole habit roster for a week. Habit contributions price against the
 * FIXED baseline. Returns the net plus a per-position breakdown for the ledger
 * metadata / Board.
 */
export function settleHabitWeek(positions: PositionWeek[]): HabitWeekResult {
  const breakdown = positions.map((p, index) => {
    const pct = settlePositionPct(p);
    return { index, pct, cents: centsFromPct(pct, BASELINE_CENTS) };
  });
  // Defensive clamp to the roster's intended weekly bounds. With the new roster
  // (3 daily assets + 1 vice) the true envelope is ~+7.0 / −8.75%, so this clamp is
  // now SLACK — it never binds in normal play. It still guards a non-standard roster
  // from blowing past ±11/−14.5%. NOTE: truncation is silent (no breadcrumb) — fine
  // at solo scale; add a Sentry breadcrumb if a real roster can ever exceed the cap.
  const totalPct = clamp(
    breakdown.reduce((s, b) => s + b.pct, 0),
    WEEK_MAX.neg,
    WEEK_MAX.pos,
  );
  return {
    totalPct,
    totalCents: centsFromPct(totalPct, BASELINE_CENTS),
    positions: breakdown,
  };
}

// (v7: the streak/recovery/collapse pure lookups — streakBonusPct,
// recoveryBonusPct, vicesCollapsePct, totalCollapsePct — were deleted with the
// layer. A habit week's contribution is now the whole habit story.)

// ── Sprint payoff ───────────────────────────────────────────────────────────────

export interface SprintPayoff {
  completionRatio: number;
  bandPct: number;
  goalBonusPct: number;
  realizedPct: number;
}

/** A payoff band FROZEN onto a sprint row at create (size already resolved to `pct`). */
export interface FrozenBand {
  upToRatio: number;
  label: string;
  pct: number;
}

/**
 * Band lookup over the bands FROZEN on the sprint row (not the live config table) —
 * mirrors `sprintBandPct`'s `<= upToRatio` step + 4dp rounding. Used at close so a
 * mid-sprint `SPRINT_PAYOFF_BANDS` tune can't retro-change an open sprint's payout.
 */
export function bandFromFrozen(bands: FrozenBand[], completionRatio: number): FrozenBand {
  const ratio = Math.round(clamp(completionRatio, 0, 1) * 1e4) / 1e4;
  for (const b of bands) if (ratio <= b.upToRatio) return b;
  return bands[bands.length - 1];
}

/** The payoff band % for a size at a given completion ratio (0..1). */
export function sprintBandPct(size: SprintSize, completionRatio: number): number {
  // Round to 4dp before the boundary comparison so float noise from done/total
  // (e.g. 0.4000000000000001) can't drop an exact-boundary completion a band.
  const ratio = Math.round(clamp(completionRatio, 0, 1) * 1e4) / 1e4;
  for (const band of SPRINT_PAYOFF_BANDS) {
    if (ratio <= band.upToRatio) return band[size];
  }
  return SPRINT_PAYOFF_BANDS[SPRINT_PAYOFF_BANDS.length - 1][size];
}

/**
 * Realized sprint return at close. Process band (symmetric) + upside-only goal
 * bonus. completionRatio = done / total tasks (0 if there are no tasks).
 */
export function sprintPayoff(
  size: SprintSize,
  completedTasks: number,
  totalTasks: number,
  goalAchieved: boolean,
): SprintPayoff {
  const completionRatio = totalTasks > 0 ? clamp(completedTasks / totalTasks, 0, 1) : 0;
  const bandPct = sprintBandPct(size, completionRatio);
  const goalBonusPct = goalAchieved ? SPRINT_GOAL_BONUS_PCT[size] : 0;
  return { completionRatio, bandPct, goalBonusPct, realizedPct: bandPct + goalBonusPct };
}

/**
 * Convert a realized sprint % into booked cents against the set-time balance grid
 * (the basis frozen at finalize), NOT the fixed baseline.
 */
export function sprintRealizedCents(realizedPct: number, setTimeBalanceCents: number): number {
  return centsFromPct(realizedPct, setTimeBalanceCents);
}

/** A sprint task for the unrealized mark: done flag + its milestone day. */
export interface SprintTaskMark {
  done: boolean;
  /** day within the term it's expected by (1-based); null → due at term end. */
  dueDay: number | null;
}

/**
 * The unrealized return %, BANDED on done/total — identical to what `sprintPayoff`
 * would book at close for the current completion (band only; the upside-only goal
 * bonus is declared at close, so it's excluded here → this is the floor "at least
 * this much"). Using the same step function as settlement means the shown figure
 * equals the close figure at any completion state (no linear-vs-band drift).
 *
 * The caller decides WHEN to surface this: the Home card shows it only once the
 * term has elapsed (founder ruling — no dollar figure while the sprint is still
 * running; task-completion % is shown instead). Due dates no longer factor in —
 * settlement counts done/total regardless of due day, so the mark mirrors that.
 */
export function unrealizedSprintPct(size: SprintSize, tasks: SprintTaskMark[]): number {
  const total = tasks.length;
  if (total === 0) return sprintBandPct(size, 0); // 0% completion → worst band (matches close)
  const done = tasks.filter((t) => t.done).length;
  return sprintBandPct(size, done / total);
}

/** The human label for the payoff band at a given completion ratio (0..1). */
export function sprintBandLabel(completionRatio: number): string {
  const ratio = Math.round(clamp(completionRatio, 0, 1) * 1e4) / 1e4;
  for (const band of SPRINT_PAYOFF_BANDS) {
    if (ratio <= band.upToRatio) return band.label;
  }
  return SPRINT_PAYOFF_BANDS[SPRINT_PAYOFF_BANDS.length - 1].label;
}

export interface SprintGridRow {
  upToRatio: number;
  label: string;
  pct: number;
  cents: number;
}
export interface SprintGrid {
  size: SprintSize;
  basisCents: number;
  bands: SprintGridRow[];
  goalBonusPct: number;
  goalBonusCents: number;
  /** Full completion + goal bonus, in cents — the finalize "complete this →" figure. */
  bestCents: number;
  /** The 0% band, in cents — the finalize "miss entirely →" figure. */
  worstCents: number;
}

/**
 * The fixed dollar payoff grid frozen at finalize: every band's % for the chosen
 * size converted to cents against the set-time balance (NOT the baseline), plus the
 * upside-only goal bonus and the best/worst envelope for the finalize preview. PURE
 * — computed at create time and stored on the sprint (locked_grid), and recomputed
 * client-side for the live "at today's balance" preview before commit.
 */
export function buildSprintGrid(size: SprintSize, basisCents: number): SprintGrid {
  const bands: SprintGridRow[] = SPRINT_PAYOFF_BANDS.map((b) => ({
    upToRatio: b.upToRatio,
    label: b.label,
    pct: b[size],
    cents: sprintRealizedCents(b[size], basisCents),
  }));
  const goalBonusPct = SPRINT_GOAL_BONUS_PCT[size];
  const fullPct = SPRINT_PAYOFF_BANDS[SPRINT_PAYOFF_BANDS.length - 1][size];
  const worstPct = SPRINT_PAYOFF_BANDS[0][size];
  return {
    size,
    basisCents,
    bands,
    goalBonusPct,
    goalBonusCents: sprintRealizedCents(goalBonusPct, basisCents),
    bestCents: sprintRealizedCents(fullPct + goalBonusPct, basisCents),
    worstCents: sprintRealizedCents(worstPct, basisCents),
  };
}

// ── Operating value (deterministic fold over the ledger) ─────────────────────────

/** operating value = baseline + Σ(ledger amount_cents). */
export function operatingValueCents(ledgerAmountsCents: number[]): number {
  return ledgerAmountsCents.reduce((sum, a) => sum + a, BASELINE_CENTS);
}

// ── Deterministic settlement keys (idempotency) ─────────────────────────────────
// One ledger event per (user_id, settlement_key); these formats must stay stable
// BYTE-IDENTICAL across versions — frozen facts replay through them. (v7 deleted
// the streak:/recovery:/collapse: builders with their layer; the two survivors are
// untouched.)

export const settlementKey = {
  habitWeek: (weekIndex: number) => `habit_week:${weekIndex}`,
  sprintRealized: (sprintId: string) => `sprint_realized:${sprintId}`,
} as const;

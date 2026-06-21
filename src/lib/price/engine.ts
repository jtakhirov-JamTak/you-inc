// You, Inc. — price engine: PURE, server-only settlement math.
//
// No I/O, no DB, no Date.now() — every function is a deterministic function of its
// inputs so it can be unit-tested and replayed. The settlement runner (separate,
// DB-aware) buckets a user's week from habit_logs + recurrence, calls these, and
// books the results into price_ledger. Keep that orchestration OUT of this file.
//
// Percent inputs are whole percents (1.75 = 1.75%). Money is integer cents.

import {
  BASELINE_CENTS,
  DAILY_HABIT,
  RECOVERY_BONUS_PCT,
  SPRINT_GOAL_BONUS_PCT,
  SPRINT_PAYOFF_BANDS,
  STREAK_BONUS_PCT,
  STREAK_BONUS_TAIL_PCT,
  TOTAL_COLLAPSE_PCT,
  VICE,
  VICES_COLLAPSE_PCT,
  WEEK_MAX,
  WEEKLY_HABIT,
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
  | { kind: 'daily'; doneDays: number; missedDays: number } // morning + daily
  // `target` is the full-week occurrence count (the divisor). completed/missed are
  // counted independently (a scheduled day is missed only once it has elapsed), so
  // they need NOT sum to target — mid-week, undone-but-not-yet-due days are neither.
  | { kind: 'weekly'; target: number; completedOccurrences: number; missedOccurrences: number };

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
    case 'weekly': {
      // No occurrences in the full week → the slot is inert (no divide-by-zero).
      if (p.target <= 0) return 0;
      const perOcc = WEEKLY_HABIT.weekCap / p.target;
      const completed = clamp(p.completedOccurrences, 0, p.target);
      const missed = clamp(p.missedOccurrences, 0, p.target);
      const net = perOcc * completed - perOcc * missed;
      return clamp(net, -WEEKLY_HABIT.weekCap, WEEKLY_HABIT.weekCap);
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
  // Defensive clamp to the roster's intended weekly bounds. With the spec roster
  // (3 assets + 2 vices) the sum never binds; the clamp only guards a non-standard
  // roster (which M3 creation must also prevent) from blowing past ±11/−14.5%.
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

// ── Streak / recovery / collapse (per category) ─────────────────────────────────
// These are pure lookups by run-length. The runner tracks the consecutive-week
// counts from history and calls these; it then books one ledger event per
// applicable (category, week).

/** Streak bonus % for the Nth consecutive full week (1-based). 17+ → tail. */
export function streakBonusPct(weekInStreak: number): number {
  if (weekInStreak <= 0) return 0;
  return STREAK_BONUS_PCT[weekInStreak] ?? STREAK_BONUS_TAIL_PCT;
}

/** Recovery bonus % for the Nth full week after a missed week (1-based). 7+ → streak. */
export function recoveryBonusPct(weekInRecovery: number): number {
  if (weekInRecovery <= 0) return 0;
  return RECOVERY_BONUS_PCT[weekInRecovery] ?? streakBonusPct(weekInRecovery);
}

/** Vices collapse penalty % for N consecutive 0/2-vice weeks (held at level 3). */
export function vicesCollapsePct(consecutiveZeroWeeks: number): number {
  if (consecutiveZeroWeeks <= 0) return 0;
  return VICES_COLLAPSE_PCT[Math.min(consecutiveZeroWeeks, VICES_COLLAPSE_PCT.length) - 1];
}

/** Total collapse penalty % for N consecutive 0/5 (all-zero) weeks (held at level 3). */
export function totalCollapsePct(consecutiveZeroWeeks: number): number {
  if (consecutiveZeroWeeks <= 0) return 0;
  return TOTAL_COLLAPSE_PCT[Math.min(consecutiveZeroWeeks, TOTAL_COLLAPSE_PCT.length) - 1];
}

// ── Sprint payoff ───────────────────────────────────────────────────────────────

export interface SprintPayoff {
  completionRatio: number;
  bandPct: number;
  goalBonusPct: number;
  realizedPct: number;
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

/** A sprint task for the live unrealized mark: done flag + its milestone day. */
export interface SprintTaskMark {
  done: boolean;
  /** day within the term it's expected by (1-based); null → due at term end. */
  dueDay: number | null;
}

/**
 * The LIVE unrealized return %, proportional per milestone (founder ruling, M2):
 * each task carries an equal 1/total slice of the sprint's full ±band (the best/
 * worst extremes, which are symmetric per size). A done task adds its slice; a task
 * whose milestone day has ENDED undone subtracts its slice; a not-yet-due task
 * counts zero. So day 1 = 0, and it converges to the extremes as milestones resolve.
 * The goal bonus is excluded (it's declared at close). Booked realized return at
 * close is separate (sprintPayoff over done/total) and unaffected by this.
 *
 * `dayOfTerm` is the 1-based current day; a milestone "has ended" once dayOfTerm is
 * strictly past it (you have until the end of the due day).
 */
export function unrealizedSprintPct(
  size: SprintSize,
  tasks: SprintTaskMark[],
  dayOfTerm: number,
  termDays: number,
): number {
  const total = tasks.length;
  if (total === 0) return 0;
  const upside = sprintBandPct(size, 1); // best band (e.g. +14% big)
  const downside = sprintBandPct(size, 0); // worst band (e.g. −14% big)
  let pct = 0;
  for (const t of tasks) {
    const due = t.dueDay ?? termDays;
    if (t.done) pct += upside / total;
    else if (dayOfTerm > due) pct += downside / total; // milestone day ended undone
    // not yet due → 0 (pending, no tally)
  }
  return pct;
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
// One ledger event per (user_id, settlement_key); these formats must stay stable.

export const settlementKey = {
  habitWeek: (weekIndex: number) => `habit_week:${weekIndex}`,
  streak: (category: string, weekIndex: number) => `streak:${category}:${weekIndex}`,
  recovery: (category: string, weekIndex: number) => `recovery:${category}:${weekIndex}`,
  collapse: (category: string, weekIndex: number) => `collapse:${category}:${weekIndex}`,
  sprintRealized: (sprintId: string) => `sprint_realized:${sprintId}`,
} as const;

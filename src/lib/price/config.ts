// You, Inc. — price engine scoring config (SINGLE SOURCE OF SCORING CONSTANTS).
//
// Every number the price engine uses lives here. The values are UNVALIDATED and
// will be tuned after the concierge test — tuning is an edit to this file, never a
// refactor of the engine. Bump SCORING_VERSION whenever the settlement OUTPUT or
// ALGORITHM changes — a tuned value HERE, or a formula/gating change in the engine
// (engine.ts / weeks.ts / settlement.ts) — so each derived ledger row stays
// attributable to the exact rules that produced it. The version stamps the
// algorithm, not just this file.
//
// Source of truth: docs/you-inc-spec.md + the founder's scoring table.
//
// Two denominators (enforced by the engine, not here):
//   • habits / streak / recovery / collapse  → % of the FIXED $200,000 baseline.
//   • sprint payoffs                          → % of balance_at_set_time (frozen).

// v2 (2026-06-20): weekly = cap/full-week-target (was cap/occurrences-so-far);
// mid-week habits score pro-rata (were excluded); partial weeks frozen out of the
// streak/collapse layer. v1 produced no settled rows in production.
export const SCORING_VERSION = 2;

/** Operating-value baseline: $200,000 in integer cents. */
export const BASELINE_CENTS = 20_000_000;

// ── Habits (weekly) ────────────────────────────────────────────────────────────
// Per-day accrual and weekly caps, in percent. Morning + daily assets share the
// "daily habit" row; the two vices share the "vice" row; the weekly slot divides
// its cap by the full week's scheduled-occurrence count (the fixed target), NOT
// occurrences-so-far — so one of three is +1/3, never the whole week.

/** Vice (liability): + per clean day, − per relapse day; each side capped. */
export const VICE = {
  perCleanDay: 0.25,
  perRelapseDay: 0.5, // applied as a negative
  weekCapPos: 1.75,
  weekCapNeg: 3.5, // applied as a negative
} as const;

/** Daily/morning asset: + per completed day, − per missed day; each side capped. */
export const DAILY_HABIT = {
  perDoneDay: 0.25,
  perMissDay: 0.25, // applied as a negative
  weekCapPos: 1.75,
  weekCapNeg: 1.75, // applied as a negative
} as const;

/** Weekly asset: ±cap divided by the full week's target occurrence count. */
export const WEEKLY_HABIT = {
  weekCap: 4.0, // per-occurrence value = weekCap / target (full Mon→Sun occurrence count)
} as const;

/** Whole-roster weekly bounds (sanity guard / reconciliation). */
export const WEEK_MAX = { pos: 11.0, neg: -14.5 } as const;

// ── Streak bonus (per category, consecutive FULL weeks) ─────────────────────────
// Front-loaded into the hard weeks; intentionally NOT monotonic. Applies
// independently to each of the three categories below. Weeks 17+ settle at 3.0%.
export const STREAK_BONUS_PCT: Readonly<Record<number, number>> = {
  1: 1.0, 2: 1.5, 3: 3.0, 4: 3.0, 5: 4.5, 6: 4.5, 7: 2.5, 8: 2.5,
  9: 2.5, 10: 2.5, 11: 4.5, 12: 4.5, 13: 6.0, 14: 6.0, 15: 4.5, 16: 4.5,
};
export const STREAK_BONUS_TAIL_PCT = 3.0; // weeks 17+

// ── Recovery bonus (consecutive full weeks AFTER a missed week) ──────────────────
// Weeks 1–6 ramp 1→6%; week 7+ "matches regular streak" (falls back to STREAK).
export const RECOVERY_BONUS_PCT: Readonly<Record<number, number>> = {
  1: 1.0, 2: 2.0, 3: 3.0, 4: 4.0, 5: 5.0, 6: 6.0,
};

// ── Collapse penalty (consecutive zero weeks) ───────────────────────────────────
// Two INDEPENDENT, STACKING penalties:
//   • vices collapse  — both vices failed (0/2), regardless of assets.
//   • total collapse  — nothing done at all (0/5, all positions).
// Both can fire in the same week and add. Index by consecutive-zero-week count;
// held at the level-3 value for 3+ weeks.
export const VICES_COLLAPSE_PCT = [-1.0, -2.0, -3.0] as const; // wk 1,2,3+
export const TOTAL_COLLAPSE_PCT = [-2.5, -3.5, -5.0] as const; // wk 1,2,3+

// ── Streak categories ───────────────────────────────────────────────────────────
// Each tracked independently for streak/recovery. "daily" = morning + daily (2/2);
// "weekly" = the weekly slot (1/1); "vices" = the two liabilities (2/2).
export const STREAK_CATEGORIES = ['vices', 'daily', 'weekly'] as const;
export type StreakCategory = (typeof STREAK_CATEGORIES)[number];

// ── Sprints (investments) ───────────────────────────────────────────────────────
export const SPRINT_SIZES = ['small', 'medium', 'big'] as const;
export type SprintSize = (typeof SPRINT_SIZES)[number];

export const SPRINT_TERM_DAYS = { min: 10, max: 14 } as const;

// Payoff by % of tasks completed. Each band gives its UPPER bound of the completion
// ratio (inclusive), a human label (reused on the Sprints grid + the realized_band
// record), and the payoff % per size. The 0.0 band is "exactly 0%".
export const SPRINT_PAYOFF_BANDS: ReadonlyArray<{
  upToRatio: number;
  label: string;
  small: number;
  medium: number;
  big: number;
}> = [
  { upToRatio: 0.0, label: "0%", small: -7.0, medium: -10.0, big: -14.0 },
  { upToRatio: 0.2, label: "1–20%", small: -5.5, medium: -8.0, big: -12.0 },
  { upToRatio: 0.4, label: "21–40%", small: -3.5, medium: -5.0, big: -7.0 },
  { upToRatio: 0.5, label: "41–50%", small: 0.0, medium: 0.0, big: 0.0 },
  { upToRatio: 0.7, label: "51–70%", small: 1.0, medium: 1.5, big: 2.0 },
  { upToRatio: 0.85, label: "71–85%", small: 3.5, medium: 5.0, big: 7.0 },
  { upToRatio: 0.99, label: "86–99%", small: 5.5, medium: 8.0, big: 12.0 },
  { upToRatio: 1.0, label: "100%", small: 7.0, medium: 10.0, big: 14.0 },
];

/** Goal-achieved bonus (upside-only), added on top of the band payoff at close. */
export const SPRINT_GOAL_BONUS_PCT: Readonly<Record<SprintSize, number>> = {
  small: 3.0,
  medium: 5.0,
  big: 6.0,
};

// Big bets are NOT gated in v0 (founder: current is good enough). Left as a future
// tuning knob — flip on and add a criterion when there's a track record to gate by.
export const BIG_BET_GATE_ENABLED = false;

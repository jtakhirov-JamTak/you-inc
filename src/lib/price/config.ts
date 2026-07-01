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
// v3 (2026-06-29): new 4-position roster (1 morning + 1 evening + 1 mission, all
// per-day "daily" role; 1 vice). The weekly cadence/role and its per-occurrence
// scoring are gone; streak categories collapse to ['vices','daily']; vices-collapse
// now needs the single vice (was both of two). Ledger wiped at the same change, so
// no v2 rows survive to reconcile.
// v4 (2026-06-29): the DAILY streak/recovery bonus scales by how many of the 3 asset
// slots are active (×assets/3: 1→⅓, 2→⅔, 3→full), and a vice collapse (the vice
// slipped every day) applies a 50% haircut to all streak/recovery bonuses that week.
// Empty-roster weeks no longer book $0 rows. Ledger empty at the bump (clean cutover).
// v5 (2026-06-30): symmetric penalty rebalance — the two collapse ladders softened so
// the worst possible week (~−13.25%) ≈ the best realistic week (+13%: habit +7 + one
// peaked streak +6). Only the collapse ladders changed; the intentional per-vice 2×
// asymmetry (VICE caps) is preserved. Display-value floor at $0 was added the same day
// (a read-path clamp, not a scoring change). Ledger empty at the bump → replay is a
// no-op; a version gap auto-replays from frozen facts (never a reset to baseline).
export const SCORING_VERSION = 5;

/** Operating-value baseline: $200,000 in integer cents. */
export const BASELINE_CENTS = 20_000_000;

// ── Settlement grace window ─────────────────────────────────────────────────────
// A calendar week ends Sunday midnight (local), but it is NOT settled or frozen
// until this many local days have fully passed — giving the user a grace day to fix
// the just-closed week's logs (forgot to log, travel, sickness, late entry) before
// the score for that week locks. With 1, a week that ends Sunday settles at the
// user's local midnight ending Monday (i.e. Tuesday 00:00 local). The grace day's
// logs remain editable; the new week runs live alongside it (Home shows last week
// as "pending settlement"). Settlement is lazy (next load at/after the boundary),
// not a scheduled job. Tunable: raise for a longer window.
export const SETTLEMENT_GRACE_DAYS = 1;

// ── Habits (weekly) ────────────────────────────────────────────────────────────
// Per-day accrual and weekly caps, in percent. All three positive assets (morning,
// evening, mission) share the "daily habit" row; the single vice uses the "vice"
// row. Every position scores per-day — there is no longer a weekly per-occurrence
// slot.

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

/** Whole-roster weekly bounds (sanity guard / reconciliation). */
// With the new 4-position roster (3 daily assets + 1 vice) the true envelope is
// ~+7.0 / −8.75%, so this clamp is now SLACK — it never binds in normal play. Left
// at the old values as a defensive backstop against a non-standard roster; raising
// a per-side cap would not be silently truncated here until the sum exceeds these.
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
//   • vices collapse  — the vice failed every day (0/1), regardless of assets.
//   • total collapse  — nothing done at all (0/4, all positions).
// Both can fire in the same week and add. Index by consecutive-zero-week count;
// held at the level-3 value for 3+ weeks.
// v5 rebalance: softened so worst-week = habit −8.75 + vices −1.5 + total −3.0 =
// −13.25% ≈ the +13% best realistic week (symmetric downside). Per-vice asymmetry
// (VICE.weekCapNeg 2× weekCapPos) is intentionally kept — only these ladders moved.
export const VICES_COLLAPSE_PCT = [-0.5, -1.0, -1.5] as const; // wk 1,2,3+ (was -1.0,-2.0,-3.0)
export const TOTAL_COLLAPSE_PCT = [-1.5, -2.5, -3.0] as const; // wk 1,2,3+ (was -2.5,-3.5,-5.0)

// ── Streak categories ───────────────────────────────────────────────────────────
// Each tracked independently for streak/recovery. "daily" = all three per-day
// assets: morning + evening + mission (3/3); "vices" = the single liability (1/1).
export const STREAK_CATEGORIES = ['vices', 'daily'] as const;
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

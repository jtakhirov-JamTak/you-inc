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
//   • habit weeks     → % of the FIXED $200,000 baseline.
//   • sprint payoffs  → % of balance_at_set_time (frozen).

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
// v6 (2026-06-30): zero-log PAUSE — a COMPLETE week where the whole roster logged
// nothing (every position completed===0) books NOTHING (no habit_week_settled, no
// streak/recovery, no collapse) and FREEZES every run (streaks + collapse ladders
// neither advance nor reset — a pause is not a miss). A week with any log scores
// normally. Ships with as-of-week-END roster membership (migration 0033, fact-only —
// no valuation change). Ledger empty at the bump → replay is a no-op.
// v7 (2026-07-01): the ENTIRE priced streak/recovery/collapse/pause layer is DELETED
// (founder decision). It carried the zero-log-pause exploit (the downside became
// opt-in: not logging ≡ pausing), a perpetual-replay perf bug (a pause week froze a
// settled_weeks fact but booked no habit_week row, so the runner's orphan check
// re-replayed on every load), non-monotonic streak/recovery incentives, and dead
// code (total collapse was unreachable) — all unvalidated with real users. v7 model:
//   net worth = $200,000 + Σ weekly habit contribution + sprint payoffs
// The weekly envelope for the full 3-asset + 1-vice roster is +7.0% (3×1.75 + 1.75)
// to −8.75% (3×(−1.75) + (−3.5)). Every non-empty frozen week books exactly one
// habit_week_settled row again (zero-log weeks now book their full downside).
// Ledger empty at the bump → replay is a no-op; any pre-v7 rows auto-replay from
// frozen facts (never a reset to baseline).
export const SCORING_VERSION = 7;

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
// The v7 envelope for the full 4-position roster (3 daily assets + 1 vice) is
// +7.0 / −8.75%, so this clamp is SLACK — it never binds in normal play. Left at
// the old values as a defensive backstop against a non-standard roster; a per-side
// cap raise would not be silently truncated here until the sum exceeds these.
export const WEEK_MAX = { pos: 11.0, neg: -14.5 } as const;

// (v7: the streak/recovery/collapse constants — STREAK_BONUS_PCT,
// STREAK_BONUS_TAIL_PCT, RECOVERY_BONUS_PCT, VICES_COLLAPSE_PCT,
// TOTAL_COLLAPSE_PCT, STREAK_CATEGORIES — were deleted with the layer.
// See the v7 changelog entry above; git history has the values.)

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

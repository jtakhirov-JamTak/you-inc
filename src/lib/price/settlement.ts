// Settlement core — PURE. Folds an ordered series of settlement weeks into the
// ledger events that move the operating value. No DB, no clock; the runner feeds
// it pre-bucketed weeks (from habit_logs) and books what it returns.
//
// Rules (v7 — the priced streak/recovery/collapse/pause layer is DELETED; see the
// v7 changelog in config.ts):
//   • Habit week contribution: Σ position contributions vs the FIXED baseline —
//     one habit_week_settled event per non-empty week. That is the WHOLE habit
//     story: per-day ± accrual, per-position caps, envelope +7.0 / −8.75% for the
//     full roster.
//   • Partial signup week scores pro-rata (its scheduled counts already reflect the
//     fewer days, so the engine's per-day math scales naturally).
//   • A zero-log week books its full downside like any other week — absence of a
//     log is an inferred miss/slip (the v6 "pause" made the downside opt-in and is
//     gone).

import { BASELINE_CENTS } from './config';
import { settleHabitWeek, settlementKey, type PositionWeek } from './engine';
import type { LocalDate } from './dates';

export type Area = 'health' | 'wealth' | 'relationships';
export type PositionRole = 'vice' | 'daily'; // morning + evening + mission → 'daily'

/** One habit's aggregated outcome for one settlement week. */
export interface PositionWeekInput {
  habitId: string;
  role: PositionRole;
  area: Area | null;
  /** asset: days/occurrences completed; vice: clean days. */
  completed: number;
  /** asset: days/occurrences missed; vice: relapse days. */
  failed: number;
  /**
   * What was actually due-or-done this week — days in the week the position
   * participated; 0 means the slot was inert this week.
   */
  scheduled: number;
  /**
   * VESTIGIAL (kept for frozen-snapshot shape stability — settled_weeks.positions
   * rows were serialized with it and must replay byte-identically at the fact
   * level). Historically the divisor for a weekly slot's per-occurrence value;
   * always === scheduled since the v3 all-per-day roster, and unread by the engine.
   */
  target: number;
  /**
   * VESTIGIAL (kept for frozen-snapshot shape stability, same as `target`).
   * True only when this position participated for a COMPLETE Mon→Sun week. It
   * gated the v3–v6 streak/recovery/collapse layer, which v7 deleted; nothing
   * reads it now, but weeks.ts keeps producing it so old and new snapshots stay
   * one shape.
   */
  fullWeek: boolean;
}

export interface WeekInput {
  weekIndex: number;
  weekStart: LocalDate;
  weekEnd: LocalDate;
  daysInWeek: number;
  positions: PositionWeekInput[];
}

export interface LedgerEventDraft {
  eventType: 'habit_week_settled';
  settlementKey: string;
  weekIndex: number;
  weekEnd: LocalDate;
  pct: number;
  amountCents: number;
  basisCents: number;
  metadata?: Record<string, unknown>;
}

// ── Position → engine mapping ────────────────────────────────────────────────────

// Every role scores per-day. `target`/`fullWeek` are vestigial (see PositionWeekInput).
function toEnginePosition(p: PositionWeekInput): PositionWeek {
  switch (p.role) {
    case 'vice':
      return { kind: 'vice', cleanDays: p.completed, relapseDays: p.failed };
    case 'daily':
      return { kind: 'daily', doneDays: p.completed, missedDays: p.failed };
  }
}

// ── Habit-week contribution ──────────────────────────────────────────────────────

function habitWeekEvent(week: WeekInput): LedgerEventDraft {
  const enginePositions = week.positions.map(toEnginePosition);
  const result = settleHabitWeek(enginePositions);

  // Per-area breakdown (untagged → 'operations') for the Board.
  const areaCents: Record<string, number> = {};
  week.positions.forEach((p, i) => {
    const bucket = p.area ?? 'operations';
    areaCents[bucket] = (areaCents[bucket] ?? 0) + result.positions[i].cents;
  });

  return {
    eventType: 'habit_week_settled',
    settlementKey: settlementKey.habitWeek(week.weekIndex),
    weekIndex: week.weekIndex,
    weekEnd: week.weekEnd,
    pct: result.totalPct,
    amountCents: result.totalCents,
    basisCents: BASELINE_CENTS,
    metadata: {
      areaCents,
      positions: week.positions.map((p, i) => ({
        habitId: p.habitId,
        role: p.role,
        pct: result.positions[i].pct,
        cents: result.positions[i].cents,
      })),
    },
  };
}

// ── The fold ─────────────────────────────────────────────────────────────────────

/**
 * Fold complete settlement weeks (ascending weekIndex) into ledger events —
 * exactly one habit_week_settled event per non-empty week (v7: the fold IS this;
 * the streak/recovery/collapse/pause layer was deleted). Deterministic: same
 * history → same events (and same settlement keys), so re-running is idempotent
 * at the DB layer, and the runner's orphan check can rely on "every non-empty
 * frozen week has its habit_week: row".
 */
export function foldSettlements(completeWeeks: WeekInput[]): LedgerEventDraft[] {
  const weeks = [...completeWeeks].sort((a, b) => a.weekIndex - b.weekIndex);
  const events: LedgerEventDraft[] = [];

  for (const week of weeks) {
    // An empty-roster week (no active habit existed yet) has nothing to settle — skip
    // it so we never book meaningless $0 rows. (Those would otherwise accrue on every
    // settlement of a habit-less account and, after a SCORING_VERSION bump, trip the
    // version guard on re-settlement.) This is the ONLY week that books nothing: a
    // zero-log week with a roster books its full downside like any other week.
    if (week.positions.length === 0) continue;

    events.push(habitWeekEvent(week));
  }

  return events;
}

/**
 * The provisional "mark" for the current, still-open week — the unrealized habit
 * contribution shown on Home's Day/Day tick. Computed on read, NEVER booked to the
 * ledger (the week books only when it closes, via foldSettlements).
 */
export function provisionalMarkCents(currentWeekPositions: PositionWeekInput[]): number {
  return settleHabitWeek(currentWeekPositions.map(toEnginePosition)).totalCents;
}

/**
 * The provisional mark broken out PER position — each habit's own unrealized
 * contribution to the current open week, for Home's per-line contrib/wk column.
 * Sums to provisionalMarkCents (modulo the whole-roster WEEK_MAX clamp, which the
 * spec roster never binds).
 */
export function provisionalMarkByPosition(
  currentWeekPositions: PositionWeekInput[],
): { habitId: string; cents: number }[] {
  const result = settleHabitWeek(currentWeekPositions.map(toEnginePosition));
  return currentWeekPositions.map((p, i) => ({
    habitId: p.habitId,
    cents: result.positions[i].cents,
  }));
}

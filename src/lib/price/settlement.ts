// Settlement core — PURE. Folds an ordered series of settlement weeks into the
// ledger events that move the operating value. No DB, no clock; the runner feeds
// it pre-bucketed weeks (from habit_logs + recurrence) and books what it returns.
//
// Rules (from the SOT + founder decisions):
//   • Habit week contribution: Σ position contributions vs the FIXED baseline.
//   • Streak (per category vices/daily/weekly): consecutive FULL weeks. A week is
//     full only if every position in the category was perfect — one slip breaks it.
//     Only COMPLETE Mon→Sun weeks count: a partial week (signup mid-week, or a
//     habit created mid-week) freezes the run (no bonus, no break). Collapse is
//     shielded the same way. The per-day contribution still books every week.
//   • Recovery: after the first non-full week for a category, full-week runs use the
//     recovery ramp (wk 1–6), then fall back to the regular streak (wk 7+).
//   • Vices collapse (−1/−2/−3): consecutive weeks where BOTH vices relapsed EVERY
//     day. Total collapse (−2.5/−3.5/−5): a vices-collapse week that is ALSO zero on
//     all assets. The two are independent and STACK.
//   • Partial signup week scores pro-rata (its scheduled counts already reflect the
//     fewer days, so the engine's per-day math scales naturally).

import { BASELINE_CENTS, STREAK_CATEGORIES, type StreakCategory } from './config';
import {
  centsFromPct,
  recoveryBonusPct,
  settleHabitWeek,
  settlementKey,
  streakBonusPct,
  totalCollapsePct,
  vicesCollapsePct,
  type PositionWeek,
} from './engine';
import type { LocalDate } from './dates';

export type Area = 'health' | 'wealth' | 'relationships';
export type PositionRole = 'vice' | 'daily' | 'weekly'; // morning + daily → 'daily'

/** One habit's aggregated outcome for one settlement week. */
export interface PositionWeekInput {
  habitId: string;
  role: PositionRole;
  area: Area | null;
  /** asset: days/occurrences completed; vice: clean days. */
  completed: number;
  /** asset: days/occurrences missed; vice: relapse days. */
  failed: number;
  /** total scheduled days (daily/vice = days in week) or occurrences (weekly). */
  scheduled: number;
  /**
   * True only when this position participated for a COMPLETE Mon→Sun week — i.e. a
   * settled week the habit existed from its calendar start (neither signup nor
   * mid-week creation truncated it). The streak/recovery/collapse layer engages
   * ONLY on full-week positions; a partial week still books its per-day ±
   * contribution but is invisible to that layer ("all streaks must encompass an
   * entire week, Monday to Sunday"). The in-progress week is never full.
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
  eventType: 'habit_week_settled' | 'streak_bonus' | 'recovery_bonus' | 'collapse_penalty';
  settlementKey: string;
  weekIndex: number;
  weekEnd: LocalDate;
  pct: number;
  amountCents: number;
  basisCents: number;
  category?: string;
  metadata?: Record<string, unknown>;
}

// ── Position → engine mapping ────────────────────────────────────────────────────

function toEnginePosition(p: PositionWeekInput): PositionWeek {
  switch (p.role) {
    case 'vice':
      return { kind: 'vice', cleanDays: p.completed, relapseDays: p.failed };
    case 'daily':
      return { kind: 'daily', doneDays: p.completed, missedDays: p.failed };
    case 'weekly':
      return { kind: 'weekly', scheduledOccurrences: p.scheduled, completedOccurrences: p.completed };
  }
}

// ── Week classification ──────────────────────────────────────────────────────────

function positionsIn(week: WeekInput, role: PositionRole): PositionWeekInput[] {
  return week.positions.filter((p) => p.role === role);
}

/** Streak category = the role bucket; vices→'vices', daily→'daily', weekly→'weekly'. */
function rolesForCategory(category: StreakCategory): PositionRole {
  return category === 'vices' ? 'vice' : category === 'daily' ? 'daily' : 'weekly';
}

// A category's outcome for one week, for streak purposes:
//   'full'    — every SCHEDULED position was perfect → extend the streak.
//   'broken'  — some scheduled position failed → reset the streak.
//   'skipped' — positions exist but NONE were scheduled this week (e.g. a weekly
//               recurrence that lands no occurrence in this calendar week). The
//               streak FREEZES: nothing was due, so it neither extends nor breaks.
//   'absent'  — the category has no positions at all (user holds no such habit).
export type CategoryClass = 'full' | 'broken' | 'skipped' | 'absent';

export function classifyCategory(week: WeekInput, category: StreakCategory): CategoryClass {
  const ps = positionsIn(week, rolesForCategory(category));
  if (ps.length === 0) return 'absent';
  const scheduled = ps.filter((p) => p.scheduled > 0);
  // Positions exist but none were due this week → freeze, don't reward.
  // (Without this, a 0-scheduled weekly slot is vacuously "perfect" — failed===0 —
  // and would hand out a free streak bonus for a week nothing was scheduled.)
  if (scheduled.length === 0) return 'skipped';
  // A partial week (signup mid-week, or a habit created mid-week) is invisible to
  // the streak layer — it neither extends nor breaks the run. Freeze it like a
  // skipped week. The per-day contribution still books via habitWeekEvent.
  if (scheduled.some((p) => !p.fullWeek)) return 'skipped';
  return scheduled.some((p) => p.failed > 0) ? 'broken' : 'full';
}

/** A category is FULL only if every scheduled position was perfect (no failure). */
export function isCategoryFull(week: WeekInput, category: StreakCategory): boolean {
  return classifyCategory(week, category) === 'full';
}

/**
 * BOTH vices relapsed every day this week. Requires the FULL vice set (2) — an
 * incomplete roster (e.g. one vice mid-setup) must never spuriously collapse and
 * book a permanent penalty. The spec collapse rule is literally "both vices".
 */
export function isVicesCollapse(week: WeekInput): boolean {
  const vices = positionsIn(week, 'vice');
  if (vices.length < 2) return false;
  // Partial weeks are shielded from collapse, symmetric with streak bonuses.
  if (vices.some((p) => !p.fullWeek)) return false;
  return vices.every((p) => p.scheduled > 0 && p.failed === p.scheduled);
}

/**
 * Vices fully collapsed AND zero completions on every SCHEDULED asset. Assets not
 * scheduled this week (e.g. a weekly slot with no occurrence) are excluded — a
 * vacuous zero must not count as a failure (mirrors the skipped-week streak
 * freeze). With no scheduled asset at all, there's nothing to total-collapse.
 */
export function isTotalCollapse(week: WeekInput): boolean {
  if (!isVicesCollapse(week)) return false;
  const assets = week.positions.filter(
    (p) => (p.role === 'daily' || p.role === 'weekly') && p.scheduled > 0 && p.fullWeek,
  );
  if (assets.length === 0) return false;
  return assets.every((p) => p.completed === 0);
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

interface CategoryState {
  streakRun: number;
  missedYet: boolean;
}

/**
 * Fold complete settlement weeks (ascending weekIndex) into ledger events.
 * Deterministic: same history → same events (and same settlement keys), so
 * re-running is idempotent at the DB layer.
 */
export function foldSettlements(completeWeeks: WeekInput[]): LedgerEventDraft[] {
  const weeks = [...completeWeeks].sort((a, b) => a.weekIndex - b.weekIndex);
  const events: LedgerEventDraft[] = [];

  const categoryState: Record<StreakCategory, CategoryState> = {
    vices: { streakRun: 0, missedYet: false },
    daily: { streakRun: 0, missedYet: false },
    weekly: { streakRun: 0, missedYet: false },
  };
  let vicesCollapseRun = 0;
  let totalCollapseRun = 0;

  for (const week of weeks) {
    // 1. Habit-week contribution (always recorded; one row per week).
    events.push(habitWeekEvent(week));

    // 2. Streak / recovery per category.
    for (const category of STREAK_CATEGORIES) {
      const state = categoryState[category];
      const cls = classifyCategory(week, category);

      // Skipped: nothing in this category was due this week → freeze the streak.
      // Don't extend, don't break, don't award a bonus, don't flip missedYet.
      if (cls === 'skipped') continue;

      if (cls === 'full') {
        state.streakRun += 1;
        const inRecovery = state.missedYet;
        const pct = inRecovery
          ? recoveryBonusPct(state.streakRun)
          : streakBonusPct(state.streakRun);
        if (pct !== 0) {
          events.push({
            eventType: inRecovery ? 'recovery_bonus' : 'streak_bonus',
            settlementKey: inRecovery
              ? settlementKey.recovery(category, week.weekIndex)
              : settlementKey.streak(category, week.weekIndex),
            weekIndex: week.weekIndex,
            weekEnd: week.weekEnd,
            pct,
            amountCents: centsFromPct(pct, BASELINE_CENTS),
            basisCents: BASELINE_CENTS,
            category,
            metadata: { streakRun: state.streakRun },
          });
        }
      } else {
        // 'broken' or 'absent' → reset and mark that a miss has occurred.
        state.streakRun = 0;
        state.missedYet = true;
      }
    }

    // 3. Collapse penalties (independent counters, stack).
    if (isVicesCollapse(week)) {
      vicesCollapseRun += 1;
      const pct = vicesCollapsePct(vicesCollapseRun);
      events.push({
        eventType: 'collapse_penalty',
        settlementKey: settlementKey.collapse('vices', week.weekIndex),
        weekIndex: week.weekIndex,
        weekEnd: week.weekEnd,
        pct,
        amountCents: centsFromPct(pct, BASELINE_CENTS),
        basisCents: BASELINE_CENTS,
        category: 'vices',
        metadata: { collapseRun: vicesCollapseRun },
      });
    } else {
      vicesCollapseRun = 0;
    }

    if (isTotalCollapse(week)) {
      totalCollapseRun += 1;
      const pct = totalCollapsePct(totalCollapseRun);
      events.push({
        eventType: 'collapse_penalty',
        settlementKey: settlementKey.collapse('total', week.weekIndex),
        weekIndex: week.weekIndex,
        weekEnd: week.weekEnd,
        pct,
        amountCents: centsFromPct(pct, BASELINE_CENTS),
        basisCents: BASELINE_CENTS,
        category: 'total',
        metadata: { collapseRun: totalCollapseRun },
      });
    } else {
      totalCollapseRun = 0;
    }
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

// Weekly statements — PURE. Aggregates the settlement fold's ledger events into
// one "statement of record" per settlement week: the week's net movement, the
// cumulative operating value at that week's close, and the per-life-area split.
// No DB, no clock — fed the drafts from foldSettlements(), so it's deterministic
// and replayable. The runner persists these into board_meetings (idempotent by
// week_index, so the first settlement of a week is permanent — same contract as
// the price_ledger) and the Home chart reads the closing series back.

import { BASELINE_CENTS } from './config';
import { compareLocalDate, type LocalDate } from './dates';

/** Minimal shape buildWeekStatements folds. LedgerEventDraft satisfies it, and so
 *  do the synthetic sprint_realized events attributed by attributeSprintsToWeeks
 *  (whose eventType is outside the fold's union). */
export interface WeekStatementEvent {
  eventType: string;
  weekIndex: number;
  weekEnd: LocalDate;
  amountCents: number;
  /** Life-area for a sprint_realized event (the sprint's domain), so its payoff
   *  buckets into that region instead of operations. Null/absent → operations. */
  area?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Life-area split of a week's movement. `operations` is the catch-all for
 *  untagged habits/sprints (and any non-area event), so
 *  health+wealth+relationships+operations always reconciles to the week delta. */
export interface AreaCents {
  health: number;
  wealth: number;
  relationships: number;
  operations: number;
}

export interface WeekStatement {
  weekIndex: number;
  weekEnd: LocalDate;
  /** Net movement booked this week (Σ of every event: habit week + attributed sprints). */
  deltaCents: number;
  /** Operating value at this week's close = baseline + Σ deltas up to and including it. */
  closingCents: number;
  areaCents: AreaCents;
}

const AREA_KEYS = ['health', 'wealth', 'relationships', 'operations'] as const;

function zeroArea(): AreaCents {
  return { health: 0, wealth: 0, relationships: 0, operations: 0 };
}

/**
 * Fold ledger-event drafts (ascending or not) into per-week statements with a
 * running closing value. Groups by weekIndex; the habit-week event carries the
 * per-area split in its metadata, while any non-area event folds into
 * `operations` so the area buckets always sum to the week delta.
 *
 * sprint_realized events (booked on their own close date, outside foldSettlements)
 * must be attributed to their close-week first via attributeSprintsToWeeks and
 * concatenated in — otherwise the board closing value diverges from the true
 * operating value (which includes sprint rows) once sprints exist. They fold into
 * `operations` here (a sprint has no habit life-area split).
 */
export function buildWeekStatements(events: WeekStatementEvent[]): WeekStatement[] {
  const byWeek = new Map<number, { weekEnd: LocalDate; deltaCents: number; areaCents: AreaCents }>();

  for (const e of events) {
    const cur = byWeek.get(e.weekIndex) ?? {
      weekEnd: e.weekEnd,
      deltaCents: 0,
      areaCents: zeroArea(),
    };
    cur.deltaCents += e.amountCents;

    if (e.eventType === 'habit_week_settled') {
      const ac = (e.metadata?.areaCents ?? {}) as Record<string, number>;
      for (const [bucket, cents] of Object.entries(ac)) {
        const key = (AREA_KEYS as readonly string[]).includes(bucket) ? (bucket as keyof AreaCents) : 'operations';
        cur.areaCents[key] += cents;
      }
    } else if (
      e.eventType === 'sprint_realized' &&
      e.area != null &&
      (AREA_KEYS as readonly string[]).includes(e.area)
    ) {
      // A sprint payoff carries its target life-area → moves that region's level.
      cur.areaCents[e.area as keyof AreaCents] += e.amountCents;
    } else {
      // Untagged sprints (and any non-area event) are cross-domain → operations,
      // so the area buckets still sum to the delta.
      cur.areaCents.operations += e.amountCents;
    }
    byWeek.set(e.weekIndex, cur);
  }

  const sorted = [...byWeek.entries()].sort(([a], [b]) => a - b);
  let running = BASELINE_CENTS;
  return sorted.map(([weekIndex, v]) => {
    running += v.deltaCents;
    return {
      weekIndex,
      weekEnd: v.weekEnd,
      deltaCents: v.deltaCents,
      closingCents: running,
      areaCents: v.areaCents,
    };
  });
}

/**
 * Attribute realized-sprint ledger rows to the settlement week they closed in, as
 * synthetic events buildWeekStatements can fold. A sprint is placed in the
 * complete week whose [weekStart, weekEnd] contains its close-date; a sprint that
 * closed in the still-open current week (no containing complete week) is dropped
 * here — it already shows in the live operating value, and lands in the board
 * statement when its week settles. `localDate` is the close-date in the user's tz.
 */
export function attributeSprintsToWeeks(
  sprints: { amountCents: number; localDate: LocalDate; area?: string | null }[],
  weeks: { weekIndex: number; weekStart: LocalDate; weekEnd: LocalDate }[],
): WeekStatementEvent[] {
  const out: WeekStatementEvent[] = [];
  for (const s of sprints) {
    const wk = weeks.find(
      (w) =>
        compareLocalDate(s.localDate, w.weekStart) >= 0 &&
        compareLocalDate(s.localDate, w.weekEnd) <= 0,
    );
    if (wk) {
      out.push({
        eventType: 'sprint_realized',
        weekIndex: wk.weekIndex,
        weekEnd: wk.weekEnd,
        amountCents: s.amountCents,
        area: s.area ?? null,
      });
    }
  }
  return out;
}

// Weekly statements — PURE. Aggregates the settlement fold's ledger events into
// one "statement of record" per settlement week: the week's net movement, the
// cumulative operating value at that week's close, and the per-life-area split.
// No DB, no clock — fed the drafts from foldSettlements(), so it's deterministic
// and replayable. The runner persists these into board_meetings (idempotent by
// week_index, so the first settlement of a week is permanent — same contract as
// the price_ledger) and the Home chart reads the closing series back.

import { BASELINE_CENTS } from './config';
import type { LedgerEventDraft } from './settlement';
import type { LocalDate } from './dates';

/** Life-area split of a week's movement. `operations` is the catch-all for
 *  bonuses/penalties (per habit-category, not per life-area) + untagged habits,
 *  so health+wealth+relationships+operations always reconciles to the week delta. */
export interface AreaCents {
  health: number;
  wealth: number;
  relationships: number;
  operations: number;
}

export interface WeekStatement {
  weekIndex: number;
  weekEnd: LocalDate;
  /** Net movement booked this week (Σ of every event: habit week + bonuses + penalties). */
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
 * per-area split in its metadata, while bonuses/penalties (which are per
 * habit-category, not per life-area) fold into `operations` so the area buckets
 * always sum to the week delta.
 *
 * NOTE (v0): sprint_realized events are booked on their own close date, not via
 * foldSettlements, so they are not attributed to a week here. The realized
 * operating value (operatingValueCents over the full ledger) still includes them;
 * only the per-week chart/board attribution omits them until the Sprints close
 * flow feeds them in.
 */
export function buildWeekStatements(events: LedgerEventDraft[]): WeekStatement[] {
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
    } else {
      // streak / recovery / collapse (and any non-area event) → operations.
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

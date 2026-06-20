// Home sprint cards — PURE. Shapes the active + queued sprints for the Home
// "Investments · Sprints" section from the sprint rows + their task counts: the
// active sprint's day-of-term and live unrealized return (the band payoff on
// tasks done so far, goal not yet realized), and each queued sprint's estimated
// start offset. No DB, no clock — the runner passes `today` + `tz`.

import { type SprintSize } from './config';
import { localDateInTz, type LocalDate } from './dates';
import { sprintPayoff, sprintRealizedCents } from './engine';
import { dayOfTerm } from './positions';

/** A sprint as Home's "Investments · Sprints" section displays it. */
export interface HomeSprint {
  sprintId: string;
  status: 'active' | 'queued';
  size: SprintSize;
  area: string;
  thesis: string;
  termDays: number;
  /** active: day X of the term (1-based, clamped); null for queued. */
  dayOfTerm: number | null;
  completedTasks: number;
  totalTasks: number;
  /** active: unrealized return so far, in cents (band payoff on tasks done); null for queued. */
  unrealizedReturnCents: number | null;
  /** queued: estimated days until it starts (active remaining + prior queued terms); null for active. */
  startsInDays: number | null;
}

export interface SprintRow {
  id: string;
  size: SprintSize;
  area: string;
  thesis: string;
  term_days: number;
  status: string;
  queue_position: number | null;
  set_time_balance_cents: number | null;
  opened_at: string | null;
}
export interface SprintTaskRow {
  sprint_id: string;
  done: boolean;
}

/** Shape the active + queued sprints for Home. */
export function buildHomeSprints(
  sprintRows: SprintRow[],
  taskRows: SprintTaskRow[],
  today: LocalDate | null,
  tz: string | null,
): { active: HomeSprint | null; queued: HomeSprint[] } {
  const counts = new Map<string, { done: number; total: number }>();
  for (const t of taskRows) {
    const e = counts.get(t.sprint_id) ?? { done: 0, total: 0 };
    e.total += 1;
    if (t.done) e.done += 1;
    counts.set(t.sprint_id, e);
  }

  const toCard = (s: SprintRow, status: 'active' | 'queued'): HomeSprint => {
    const tc = counts.get(s.id) ?? { done: 0, total: 0 };
    const payoff = sprintPayoff(s.size, tc.done, tc.total, false);
    const openedLocal = s.opened_at && tz ? localDateInTz(new Date(s.opened_at), tz) : null;
    return {
      sprintId: s.id,
      status,
      size: s.size,
      area: s.area,
      thesis: s.thesis,
      termDays: s.term_days,
      dayOfTerm: status === 'active' && today ? dayOfTerm(openedLocal, s.term_days, today) : null,
      completedTasks: tc.done,
      totalTasks: tc.total,
      unrealizedReturnCents:
        status === 'active' ? sprintRealizedCents(payoff.realizedPct, s.set_time_balance_cents ?? 0) : null,
      startsInDays: null,
    };
  };

  const active = sprintRows.find((s) => s.status === 'active') ?? null;
  const activeCard = active ? toCard(active, 'active') : null;

  // Queued sprints start in sequence after the active one finishes.
  let cursor =
    activeCard && activeCard.dayOfTerm != null ? Math.max(0, activeCard.termDays - activeCard.dayOfTerm) : 0;
  const queued = sprintRows
    .filter((s) => s.status === 'queued')
    .sort((a, b) => (a.queue_position ?? 0) - (b.queue_position ?? 0))
    .map((s) => {
      const card = toCard(s, 'queued');
      card.startsInDays = cursor;
      cursor += s.term_days;
      return card;
    });

  return { active: activeCard, queued };
}

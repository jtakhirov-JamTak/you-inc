// Home sprint cards — PURE. Shapes the active + queued sprints for the Home
// "Investments · Sprints" section from the sprint rows + their task counts: the
// active sprint's day-of-term, its task-completion counts, and a banded dollar
// mark surfaced ONLY once the term has elapsed (band payoff on done/total; the
// card shows task-% while it's still running), plus each queued sprint's estimated
// start offset. No DB, no clock — the runner passes `today` + `tz`.

import { type SprintSize } from './config';
import { localDateInTz, type LocalDate } from './dates';
import { sprintRealizedCents, unrealizedSprintPct, type SprintTaskMark } from './engine';
import { dayOfTerm } from './positions';
import { deriveTicker } from '../habits/ticker';

/** A sprint as Home's "Investments · Sprints" section displays it. */
export interface HomeSprint {
  sprintId: string;
  status: 'active' | 'queued';
  size: SprintSize;
  area: string;
  thesis: string;
  /** short uppercase symbol for the gold investment row (derived from the thesis). */
  ticker: string;
  termDays: number;
  /** active: day X of the term (1-based, clamped); null for queued. */
  dayOfTerm: number | null;
  completedTasks: number;
  totalTasks: number;
  /** banded return in cents (== what closing now books, band only), surfaced ONLY once
   * the term has elapsed; null while still running or queued (card shows task-% instead). */
  unrealizedReturnCents: number | null;
  /** queued: estimated days until it starts (active remaining + prior queued terms); null for active. */
  startsInDays: number | null;
  /** the sprint's task checklist (position order) — the active card's tap targets. */
  tasks: HomeSprintTask[];
}

export interface HomeSprintTask {
  id: string;
  title: string;
  done: boolean;
  dueDay: number | null;
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
  id: string;
  title: string;
  sprint_id: string;
  done: boolean;
  position: number;
  /** milestone day within the term (1-based); null → due at term end. */
  due_day: number | null;
}

/** Shape the active + queued sprints for Home. */
export function buildHomeSprints(
  sprintRows: SprintRow[],
  taskRows: SprintTaskRow[],
  today: LocalDate | null,
  tz: string | null,
): { active: HomeSprint | null; queued: HomeSprint[] } {
  // Per-sprint task rows, sorted by position (the display + checklist order).
  const tasksBySprint = new Map<string, SprintTaskRow[]>();
  for (const t of taskRows) {
    const arr = tasksBySprint.get(t.sprint_id) ?? [];
    arr.push(t);
    tasksBySprint.set(t.sprint_id, arr);
  }
  for (const arr of tasksBySprint.values()) arr.sort((a, b) => a.position - b.position);

  // Distinct tickers across the shown sprints (active first, then queued).
  const takenTickers = new Set<string>();

  const toCard = (s: SprintRow, status: 'active' | 'queued'): HomeSprint => {
    const rows = tasksBySprint.get(s.id) ?? [];
    const marks: SprintTaskMark[] = rows.map((t) => ({ done: t.done, dueDay: t.due_day }));
    const completedTasks = marks.filter((t) => t.done).length;
    const openedLocal = s.opened_at && tz ? localDateInTz(new Date(s.opened_at), tz) : null;
    const day = status === 'active' && today ? dayOfTerm(openedLocal, s.term_days, today) : null;
    return {
      sprintId: s.id,
      status,
      size: s.size,
      area: s.area,
      thesis: s.thesis,
      ticker: deriveTicker(s.thesis, takenTickers),
      termDays: s.term_days,
      dayOfTerm: day,
      completedTasks,
      totalTasks: marks.length,
      tasks: rows.map((t) => ({ id: t.id, title: t.title, done: t.done, dueDay: t.due_day })),
      // Dollar mark is withheld until the sprint is DONE (founder ruling): the card
      // shows task-completion % while it's still running, and a dollar figure only
      // once the term (due date) has elapsed. When shown it's the BANDED value on
      // done/total, so it equals what closing now would book (band only; the goal
      // bonus is declared at close). Queued or still-running → null.
      unrealizedReturnCents:
        status === 'active' && day != null && day >= s.term_days
          ? sprintRealizedCents(
              unrealizedSprintPct(s.size, marks),
              s.set_time_balance_cents ?? 0,
            )
          : null,
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

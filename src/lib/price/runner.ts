// Settlement runner — SERVER ONLY. The DB-aware bridge between habit_logs and the
// append-only price_ledger. Buckets a user's elapsed weeks (in their timezone),
// runs the pure settlement fold, and books the resulting events idempotently via
// the service-role client. NEVER import this into client components or middleware.
//
// v0 simplifications (flagged for later):
//   • Settlement uses the user's CURRENTLY-active roster for the weeks it settles;
//     it does not reconstruct historical roster changes. Idempotent keys mean
//     already-booked weeks are never rewritten, so this only affects brand-new
//     weeks settled after a roster change.
//   • A habit participates in a week only if it existed at that week's start.
//   • Board-meeting rows and daily trend snapshots are populated by the Board /
//     Home work, not here.
//
// SECURITY: callers MUST pass the AUTHENTICATED user's id (from
// supabase.auth.getUser()), never a client-supplied id — these functions run
// under the service role and bypass RLS.
import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';
import { SCORING_VERSION, type SprintSize } from './config';
import { addDays, compareLocalDate, localDateInTz, type LocalDate } from './dates';
import { operatingValueCents, sprintPayoff, sprintRealizedCents } from './engine';
import { foldSettlements, provisionalMarkCents, provisionalMarkByPosition } from './settlement';
import { buildWeekStatements } from './statements';
import { dayOfTerm, daysClean } from './positions';
import { buildWeeks, type HabitRow, type LogRow } from './weeks';

export interface SettleResult {
  weeksSettled: number;
  eventsBooked: number;
}

/** Settle every fully-elapsed, unbooked week for the user. Idempotent. */
export async function settleUser(userId: string): Promise<SettleResult> {
  const supabase = createServiceClient();

  const [settingsRes, profileRes, habitsRes, logsRes] = await Promise.all([
    supabase.from('user_settings').select('timezone, week_start').eq('user_id', userId).single(),
    supabase.from('user_profiles').select('created_at').eq('id', userId).single(),
    supabase
      .from('habits')
      .select('id, kind, cadence, area, status, created_at, term_started_on, recurrence_rule')
      .eq('user_id', userId),
    supabase.from('habit_logs').select('habit_id, status, local_date').eq('user_id', userId),
  ]);

  // The roster reads MUST succeed before we book anything: a transient error
  // returns null data, which would otherwise settle the user at an empty roster
  // and book that wrong result permanently (the idempotent key blocks a redo).
  if (habitsRes.error || logsRes.error) {
    console.error('settleUser: roster read failed', habitsRes.error?.code ?? logsRes.error?.code);
    throw new Error('settlement_read_failed');
  }
  const settings = settingsRes.data;
  const profile = profileRes.data;
  // Missing settings/profile (e.g. signup not finished) → skip settlement, no harm.
  if (!settings || !profile) return { weeksSettled: 0, eventsBooked: 0 };
  const habits = habitsRes.data;
  const logs = logsRes.data;

  const tz = settings.timezone;
  const signupLocal = localDateInTz(new Date(profile.created_at), tz);
  const currentLocal = localDateInTz(new Date(), tz);

  const { complete } = buildWeeks(
    signupLocal,
    currentLocal,
    settings.week_start,
    tz,
    (habits ?? []) as HabitRow[],
    (logs ?? []) as LogRow[],
  );

  const events = foldSettlements(complete);
  if (events.length === 0) return { weeksSettled: complete.length, eventsBooked: 0 };

  const rows = events.map((e) => ({
    user_id: userId,
    event_type: e.eventType,
    settlement_key: e.settlementKey,
    amount_cents: e.amountCents,
    pct: e.pct,
    basis_cents: e.basisCents,
    scoring_version: SCORING_VERSION,
    // weekEnd at noon UTC. LOAD-BEARING: the settled-week write-lock trigger
    // (migration 0011) derives the frozen range [weekEnd-6, weekEnd] from this
    // exact stamp — do not change the format without updating 0011 in lockstep.
    occurred_at: `${e.weekEnd}T12:00:00Z`,
    metadata: (e.metadata ?? {}) as never,
  }));

  // Idempotent: the unique (user_id, settlement_key) skips already-booked events.
  const { error } = await supabase
    .from('price_ledger')
    .upsert(rows, { onConflict: 'user_id,settlement_key', ignoreDuplicates: true });
  if (error) {
    console.error('settleUser: ledger upsert failed', error.code);
    throw new Error('settlement_failed');
  }

  // Statement of record per week → board_meetings. Idempotent by week_index, so
  // the first settlement's figures are permanent (same contract as the ledger);
  // `ignoreDuplicates` also backfills board rows for weeks settled before this
  // write existed, since foldSettlements reprocesses every complete week. The
  // user-authored `note` is left null for them to fill on the Board screen.
  const statements = buildWeekStatements(events);
  if (statements.length > 0) {
    const boardRows = statements.map((s) => ({
      user_id: userId,
      week_index: s.weekIndex,
      closing_value_cents: s.closingCents,
      week_delta_cents: s.deltaCents,
      area_contributions: s.areaCents as never,
      settled_at: `${s.weekEnd}T12:00:00Z`,
    }));
    const { error: boardErr } = await supabase
      .from('board_meetings')
      .upsert(boardRows, { onConflict: 'user_id,week_index', ignoreDuplicates: true });
    if (boardErr) {
      // Non-fatal: the ledger (the authoritative store) already committed. A
      // failed board write just means the statement backfills on the next run.
      console.error('settleUser: board_meetings upsert failed', boardErr.code);
    }
  }

  return { weeksSettled: complete.length, eventsBooked: rows.length };
}

/** One active habit as Home displays it (spec §Home Positions). */
export interface HomePosition {
  habitId: string;
  kind: 'asset' | 'liability';
  cadence: string | null;
  area: string | null;
  title: string;
  termDays: number | null;
  /** asset: day X of the term (1-based, clamped); null for a vice. */
  dayOfTerm: number | null;
  /** vice: consecutive clean days; null for an asset. */
  daysClean: number | null;
  /** this habit's unrealized contribution to the current open week, in cents. */
  contribCents: number;
}

/** One point on Home's trend chart: a settled week's closing value (plus a final
 *  live point for the current, still-open value). */
export interface SeriesPoint {
  weekEnd: LocalDate;
  closingCents: number;
}

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

export interface OperatingState {
  realizedCents: number;
  provisionalCents: number;
  displayedCents: number;
  /** WoW: this week's live movement so far (= provisionalCents). */
  weekDeltaCents: number;
  /** DoD: today's live movement (provisional today − provisional as of end of yesterday). */
  dayDeltaCents: number;
  /** Active roster as position rows, ordered as read (created_at asc upstream). */
  positions: HomePosition[];
  /** Weekly closing values for the trend chart + a final live point. */
  series: SeriesPoint[];
  /** The active sprint (if any) + the queued sprints, for Home's investments section. */
  sprints: { active: HomeSprint | null; queued: HomeSprint[] };
}

/**
 * The Home operating value + position rows: the realized ledger fold plus the
 * current week's provisional (unbooked) habit mark, and each active habit's
 * display row (term progress / days clean / per-line contribution). Settles any
 * elapsed weeks first.
 */
export async function getOperatingState(userId: string): Promise<OperatingState> {
  await settleUser(userId);
  const supabase = createServiceClient();

  const [settingsRes, profileRes, habitsRes, logsRes, ledgerRes, boardRes, sprintsRes, tasksRes] =
    await Promise.all([
      supabase.from('user_settings').select('timezone, week_start').eq('user_id', userId).single(),
      supabase.from('user_profiles').select('created_at').eq('id', userId).single(),
      supabase
        .from('habits')
        .select(
          'id, kind, cadence, area, status, created_at, term_started_on, recurrence_rule, title, term_days',
        )
        .eq('user_id', userId),
      supabase.from('habit_logs').select('habit_id, status, local_date').eq('user_id', userId),
      supabase.from('price_ledger').select('amount_cents').eq('user_id', userId),
      // Supplementary (Home chart + sprint cards). NOT in the throw-guard below:
      // if any fails, Home still shows the authoritative value; the chart/sprints
      // just degrade to empty.
      supabase
        .from('board_meetings')
        .select('week_index, closing_value_cents, settled_at')
        .eq('user_id', userId),
      supabase
        .from('sprints')
        .select('id, size, area, thesis, term_days, status, queue_position, set_time_balance_cents, opened_at')
        .eq('user_id', userId)
        .in('status', ['active', 'queued']),
      supabase.from('sprint_tasks').select('sprint_id, done').eq('user_id', userId),
    ]);

  // Check .error on EVERY read before acting (CLAUDE.md lesson). A transient
  // failure on any of these must surface as "value unavailable" — never render a
  // partial state (empty roster, $0 provisional) as if it were authoritative.
  // `.single()` returns an error when no row exists; settings/profile may legitimately
  // be absent (signup not finished), so those are allowed to be null (PGRST116).
  const settingsErr = settingsRes.error && settingsRes.error.code !== 'PGRST116';
  const profileErr = profileRes.error && profileRes.error.code !== 'PGRST116';
  if (ledgerRes.error || habitsRes.error || logsRes.error || settingsErr || profileErr) {
    console.error(
      'getOperatingState: read failed',
      ledgerRes.error?.code ??
        habitsRes.error?.code ??
        logsRes.error?.code ??
        settingsRes.error?.code ??
        profileRes.error?.code,
    );
    throw new Error('operating_value_read_failed');
  }
  const settings = settingsRes.data;
  const profile = profileRes.data;
  const habits = habitsRes.data;
  const logs = logsRes.data;
  const realizedCents = operatingValueCents((ledgerRes.data ?? []).map((r) => r.amount_cents));

  const tz = settings?.timezone ?? null;
  const today = tz ? localDateInTz(new Date(), tz) : null;

  let provisionalCents = 0;
  let dayDeltaCents = 0;
  let positions: HomePosition[] = [];
  if (settings && profile && tz && today) {
    const signupLocal = localDateInTz(new Date(profile.created_at), tz);
    const habitRows = (habits ?? []) as HabitRow[];
    const logRows = (logs ?? []) as LogRow[];
    const { current } = buildWeeks(signupLocal, today, settings.week_start, tz, habitRows, logRows);

    // Per-position contribution for THIS week. A habit created mid-week isn't
    // scored yet (buildWeeks excludes it), so it simply maps to 0 here.
    const contribByHabit = new Map<string, number>();
    if (current) {
      provisionalCents = provisionalMarkCents(current.positions);
      for (const c of provisionalMarkByPosition(current.positions)) {
        contribByHabit.set(c.habitId, c.cents);
      }
    }

    // DoD: today's movement = provisional now − provisional as of end of yesterday.
    // Computed within the current week only; before the week's start it's the full
    // provisional (the week's whole gain happened since it opened).
    if (current && compareLocalDate(addDays(today, -1), current.weekStart) >= 0) {
      const builtY = buildWeeks(signupLocal, addDays(today, -1), settings.week_start, tz, habitRows, logRows);
      dayDeltaCents =
        builtY.current && builtY.current.weekStart === current.weekStart
          ? provisionalCents - provisionalMarkCents(builtY.current.positions)
          : provisionalCents;
    } else {
      dayDeltaCents = provisionalCents;
    }

    const allLogs = logRows;
    positions = (habits ?? [])
      .filter((h) => h.status === 'active')
      .map((h) => {
        const isAsset = h.kind === 'asset';
        const startLocal = localDateInTz(new Date(h.created_at), tz);
        const relapseDates = allLogs
          .filter((l) => l.habit_id === h.id && l.status === 'relapse')
          .map((l) => l.local_date);
        return {
          habitId: h.id,
          kind: isAsset ? ('asset' as const) : ('liability' as const),
          cadence: h.cadence,
          area: h.area,
          title: h.title,
          termDays: h.term_days ?? null,
          dayOfTerm: isAsset ? dayOfTerm(h.term_started_on, h.term_days, today) : null,
          daysClean: isAsset ? null : daysClean(relapseDates, startLocal, today),
          contribCents: contribByHabit.get(h.id) ?? 0,
        };
      });
  }

  // Trend series: settled-week closings (board_meetings) + a final live point.
  const series: SeriesPoint[] = (boardRes.error ? [] : (boardRes.data ?? []))
    .slice()
    .sort((a, b) => a.week_index - b.week_index)
    .map((r) => ({ weekEnd: String(r.settled_at).slice(0, 10), closingCents: r.closing_value_cents }));
  if (today) series.push({ weekEnd: today, closingCents: realizedCents + provisionalCents });

  const sprints = buildHomeSprints(
    (sprintsRes.error ? [] : (sprintsRes.data ?? [])) as SprintRow[],
    (tasksRes.error ? [] : (tasksRes.data ?? [])) as TaskRow[],
    today,
    tz,
  );

  return {
    realizedCents,
    provisionalCents,
    displayedCents: realizedCents + provisionalCents,
    weekDeltaCents: provisionalCents,
    dayDeltaCents,
    positions,
    series,
    sprints,
  };
}

// ── Sprint cards (Home) ────────────────────────────────────────────────────────
type SprintRow = {
  id: string;
  size: SprintSize;
  area: string;
  thesis: string;
  term_days: number;
  status: string;
  queue_position: number | null;
  set_time_balance_cents: number | null;
  opened_at: string | null;
};
type TaskRow = { sprint_id: string; done: boolean };

/** Shape the active + queued sprints for Home, with the active one's live
 *  unrealized return (band payoff on tasks done so far, goal not yet realized). */
function buildHomeSprints(
  sprintRows: SprintRow[],
  taskRows: TaskRow[],
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

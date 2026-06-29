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
import { BASELINE_CENTS, SCORING_VERSION } from './config';
import { addDays, compareLocalDate, localDateInTz, type LocalDate } from './dates';
import { DAY_OPEN_MINUTE, minutesSince6am } from '../display-day';
import { operatingValueCents } from './engine';
import { foldSettlements, provisionalMarkCents, provisionalMarkByPosition } from './settlement';
import { attributeSprintsToWeeks, buildWeekStatements } from './statements';
import { buildHomeSprints, type HomeSprint, type SprintRow, type SprintTaskRow } from './sprints';
import { dayOfTerm, daysDoneInTerm, daysClean, inferredViceSlipDates } from './positions';
import { deriveTicker } from '../habits/ticker';
import { buildWeeks, type HabitRow, type LogRow } from './weeks';

export type { HomeSprint } from './sprints';

/** Wall-clock minute-of-day (0..1439) of an instant in the user's IANA zone. */
function minuteOfDayInTz(instantIso: string, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(instantIso));
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24; // midnight may render '24'
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hh * 60 + mm;
}

export interface SettleResult {
  weeksSettled: number;
  eventsBooked: number;
}

/** Settle every fully-elapsed, unbooked week for the user. Idempotent. */
export async function settleUser(userId: string): Promise<SettleResult> {
  const supabase = createServiceClient();

  const [settingsRes, profileRes, habitsRes, logsRes, staleVersionRes] = await Promise.all([
    supabase.from('user_settings').select('timezone, week_start').eq('user_id', userId).single(),
    supabase.from('user_profiles').select('created_at').eq('id', userId).single(),
    supabase
      .from('habits')
      .select('id, kind, cadence, area, status, created_at, term_started_on, recurrence_rule')
      .eq('user_id', userId),
    supabase.from('habit_logs').select('habit_id, status, local_date').eq('user_id', userId),
    // Version guard: any HABIT-settlement row booked under an OLDER scoring
    // version. Sprint rows are excluded — their payoff math is version-stable, so
    // v2/v3 sprint rows coexist safely; only the habit-week family changed.
    supabase
      .from('price_ledger')
      .select('scoring_version')
      .eq('user_id', userId)
      .in('event_type', ['habit_week_settled', 'streak_bonus', 'recovery_bonus', 'collapse_penalty'])
      .lt('scoring_version', SCORING_VERSION)
      .limit(1),
  ]);

  // The roster reads MUST succeed before we book anything: a transient error
  // returns null data, which would otherwise settle the user at an empty roster
  // and book that wrong result permanently (the idempotent key blocks a redo).
  if (habitsRes.error || logsRes.error || staleVersionRes.error) {
    console.error(
      'settleUser: roster read failed',
      habitsRes.error?.code ?? logsRes.error?.code ?? staleVersionRes.error?.code,
    );
    throw new Error('settlement_read_failed');
  }

  // IRREVERSIBLE-LEDGER SAFETY. If a habit-settlement row was booked under an
  // earlier SCORING_VERSION, the algorithm has changed under a ledger that
  // idempotent-by-key settlement can NEVER rewrite. Re-running would book the new
  // version's weeks alongside the stale ones, silently mixing two scoring regimes
  // into one operating value. Refuse to book and surface loudly (Home renders
  // "value unavailable") rather than corrupt the price. Clearing this is a
  // deliberate per-user ledger reset, never a silent recompute. (The redesign's
  // own v2→v3 cutover assumed a hand-run reset that no migration codifies — this
  // is the codified backstop for it.)
  if ((staleVersionRes.data ?? []).length > 0) {
    console.error('settleUser: stale scoring_version in ledger; refusing to book mixed regime', userId);
    throw new Error('settlement_version_mismatch');
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
  //
  // Sprint returns are booked outside foldSettlements (their own close-date row),
  // so fold the realized-sprint ledger rows into their close-week here — without
  // this the board closing value diverges from the true operating value (which
  // includes sprint rows) once sprints exist. A read failure just omits them.
  const sprintLedgerRes = await supabase
    .from('price_ledger')
    .select('amount_cents, occurred_at')
    .eq('user_id', userId)
    .eq('event_type', 'sprint_realized');
  if (sprintLedgerRes.error) {
    console.error('settleUser: sprint ledger read failed', sprintLedgerRes.error.code);
  }
  const sprintEvents = attributeSprintsToWeeks(
    (sprintLedgerRes.data ?? []).map((r) => ({
      amountCents: r.amount_cents,
      localDate: localDateInTz(new Date(r.occurred_at), tz),
    })),
    complete,
  );
  const statements = buildWeekStatements([...events, ...sprintEvents]);
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
  /** short uppercase symbol for the holdings row (derived from the title). */
  ticker: string;
  kind: 'asset' | 'liability';
  cadence: string | null;
  area: string | null;
  title: string;
  termDays: number | null;
  /** asset: day X of the term (1-based, clamped); null for a vice. */
  dayOfTerm: number | null;
  /** asset: distinct days marked done within the current term [start..today]; null
   *  for a vice. Drives the Habits "matures by accumulation" progress bar. */
  daysDone: number | null;
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

/** One step on Home's intraday "today" (1D) chart. */
export interface IntradayPoint {
  /** minutes since the 6 AM day-open (0..1439); 0 = 6 AM, ~1439 = next 5:59 AM. */
  minuteSince6am: number;
  /** operating value the moment that log landed (realized + provisional so far). */
  valueCents: number;
}

/** Home's 1D series: a flat day-open baseline that steps at each of the day's logs.
 *  The "day" is 6 AM → 5:59 AM (display only — scoring stays calendar-dated). */
export interface IntradayToday {
  /** value as the 6 AM day opened (all earlier logs folded in; in-window excluded). */
  dayOpenCents: number;
  /** the 6 AM-day's affirmative logs as cumulative value steps, ascending by time. */
  points: IntradayPoint[];
  /** the 6 AM-day's anchor date (YYYY-MM-DD), or '' if tz/today unknown. */
  localDate: string;
}

export interface OperatingState {
  realizedCents: number;
  provisionalCents: number;
  displayedCents: number;
  /** The inception value (= operating value at signup) — the chart's ALL-range open. */
  baselineCents: number;
  /** WoW: this week's live movement so far (= provisionalCents). */
  weekDeltaCents: number;
  /** DoD: today's live movement (provisional today − provisional as of end of yesterday). */
  dayDeltaCents: number;
  /** Active roster as position rows, ordered as read (created_at asc upstream). */
  positions: HomePosition[];
  /** Weekly closing values for the trend chart + a final live point. */
  series: SeriesPoint[];
  /** Today's intraday steps for Home's 1D view (Robinhood-style live chart). */
  intraday: IntradayToday;
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

  const [
    settingsRes,
    profileRes,
    habitsRes,
    logsRes,
    ledgerRes,
    boardRes,
    sprintsRes,
    tasksRes,
  ] = await Promise.all([
      supabase.from('user_settings').select('timezone, week_start').eq('user_id', userId).single(),
      supabase.from('user_profiles').select('created_at').eq('id', userId).single(),
      supabase
        .from('habits')
        .select(
          'id, kind, cadence, area, status, created_at, term_started_on, recurrence_rule, title, term_days',
        )
        .eq('user_id', userId),
      supabase
        .from('habit_logs')
        .select('habit_id, status, local_date, occurred_at')
        .eq('user_id', userId),
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
      supabase
        .from('sprint_tasks')
        .select('id, title, sprint_id, done, position, due_day')
        .eq('user_id', userId),
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
  let intraday: IntradayToday = { dayOpenCents: realizedCents, points: [], localDate: today ?? '' };
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
          : // Yesterday was in a prior week → today is the week's first day.
            provisionalCents;
    } else {
      dayDeltaCents = provisionalCents;
    }

    // Intraday "today" series for Home's 1D chart, anchored to a 6 AM "day" (6 AM →
    // 5:59 AM) — DISPLAY ONLY; scoring stays calendar-dated. The current 6 AM-day
    // starts at 6 AM today if it's already past 6 AM, else at 6 AM yesterday.
    // dayOpenCents is the value as that 6 AM-day opened (every earlier log folded
    // in, including any from the prior midnight–6 AM); each completion since then
    // steps the value up at its minutes-since-6 AM. Replaying the window's logs in
    // occurred_at order lands the last step on displayedCents; an empty window's
    // flat open equals displayedCents. Cost: one buildWeeks per window-log
    // (a handful/day) — acceptable at solo scale.
    type RawLog = LogRow & { occurred_at: string | null };
    const rawLogs = (logs ?? []) as RawLog[];
    const nowMinute = minuteOfDayInTz(new Date().toISOString(), tz);
    const dayAnchor = nowMinute >= DAY_OPEN_MINUTE ? today : addDays(today, -1);
    const nextDay = addDays(dayAnchor, 1);
    // A log is inside the current 6 AM-day window [dayAnchor 6 AM, nextDay 6 AM)?
    // Decided by its local clock, so a midnight–6 AM log stays with the prior day.
    const inDayWindow = (l: RawLog): boolean => {
      if (l.occurred_at == null) return false;
      const m = minuteOfDayInTz(l.occurred_at, tz);
      if (l.local_date === dayAnchor) return m >= DAY_OPEN_MINUTE;
      if (l.local_date === nextDay) return m < DAY_OPEN_MINUTE;
      return false;
    };
    const windowLogs = rawLogs
      .filter(inDayWindow)
      .sort((a, b) =>
        a.occurred_at! < b.occurred_at! ? -1 : a.occurred_at! > b.occurred_at! ? 1 : 0,
      );
    const priorLogs = rawLogs.filter((l) => !inDayWindow(l));
    const builtOpen = buildWeeks(signupLocal, today, settings.week_start, tz, habitRows, priorLogs);
    const dayOpenCents =
      realizedCents + (builtOpen.current ? provisionalMarkCents(builtOpen.current.positions) : 0);
    const points: IntradayPoint[] = [];
    for (let k = 1; k <= windowLogs.length; k++) {
      const subset = [...priorLogs, ...windowLogs.slice(0, k)];
      const builtK = buildWeeks(signupLocal, today, settings.week_start, tz, habitRows, subset);
      const provK = builtK.current ? provisionalMarkCents(builtK.current.positions) : 0;
      const m = minuteOfDayInTz(windowLogs[k - 1].occurred_at!, tz);
      points.push({
        minuteSince6am: minutesSince6am(m),
        valueCents: realizedCents + provK,
      });
    }
    intraday = { dayOpenCents, points, localDate: dayAnchor };

    const allLogs = logRows;

    // Tickers are derived in roster order (created_at asc), deduped across the set.
    const takenTickers = new Set<string>();

    positions = (habits ?? [])
      .filter((h) => h.status === 'active')
      .map((h) => {
        const isAsset = h.kind === 'asset';
        const startLocal = localDateInTz(new Date(h.created_at), tz);
        // A vice slip is the INFERRED absence of a 'done' ("paid/avoided") log on
        // an elapsed day — there are no 'relapse' rows under the affirmative model.
        const doneDates = allLogs
          .filter((l) => l.habit_id === h.id && l.status === 'done')
          .map((l) => l.local_date);
        const contribCents = contribByHabit.get(h.id) ?? 0;
        return {
          habitId: h.id,
          ticker: deriveTicker(h.title, takenTickers),
          kind: isAsset ? ('asset' as const) : ('liability' as const),
          cadence: h.cadence,
          area: h.area,
          title: h.title,
          termDays: h.term_days ?? null,
          dayOfTerm: isAsset ? dayOfTerm(h.term_started_on, h.term_days, today) : null,
          daysDone: isAsset ? daysDoneInTerm(doneDates, h.term_started_on, today) : null,
          daysClean: isAsset
            ? null
            : daysClean(inferredViceSlipDates(doneDates, startLocal, today), startLocal, today),
          contribCents,
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
    (tasksRes.error ? [] : (tasksRes.data ?? [])) as SprintTaskRow[],
    today,
    tz,
  );

  return {
    realizedCents,
    provisionalCents,
    displayedCents: realizedCents + provisionalCents,
    baselineCents: BASELINE_CENTS,
    weekDeltaCents: provisionalCents,
    dayDeltaCents,
    positions,
    series,
    intraday,
    sprints,
  };
}

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
import { addDays, compareLocalDate, localDateInTz, weekStartOf, type LocalDate } from './dates';
import { DAY_OPEN_MINUTE, minutesSince6am } from '../display-day';
import { operatingValueCents, settlementKey } from './engine';
import {
  foldSettlements,
  provisionalMarkCents,
  provisionalMarkByPosition,
  type PositionWeekInput,
  type WeekInput,
} from './settlement';
import { attributeSprintsToWeeks, buildWeekStatements } from './statements';
import { buildHomeSprints, type HomeSprint, type SprintRow, type SprintTaskRow } from './sprints';
import { dayOfTerm, daysDoneInTerm, daysClean, inferredViceSlipDates } from './positions';
import { deriveTicker } from '../habits/ticker';
import { buildWeeks, type HabitRow, type LogRow } from './weeks';

export type { HomeSprint } from './sprints';

/** The three leveling life areas on Home's RPG map. Habits/sprints tagged with any
 *  other (or no) area move the total operating value but not a region level. */
export type RegionArea = 'health' | 'wealth' | 'relationships';
const REGION_AREAS: readonly RegionArea[] = ['health', 'wealth', 'relationships'];

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

/**
 * Settle a user up to now under the PROJECTION model. Two responsibilities:
 *
 *   1. FREEZE FACTS — for each week that has crossed its grace boundary and isn't
 *      yet recorded, write an immutable `settled_weeks` snapshot (the bucketed
 *      position inputs). This write-once row is the freeze anchor (migration 0029)
 *      and survives any later roster/area/timezone edit, so a replay re-scores that
 *      week from exactly what was true then.
 *
 *   2. REBUILD THE PROJECTION — recompute the user's whole `price_ledger` + board
 *      statements from ALL frozen facts (`settled_weeks` + `sprint_closes`) under the
 *      CURRENT scoring constants, and swap them in atomically (the
 *      `replay_user_projection` RPC). This runs whenever a new fact was just frozen
 *      OR a version gap is detected (a constant was tuned + SCORING_VERSION bumped).
 *      A version bump is therefore a REPLAY that re-derives value from real history —
 *      never a reset to baseline. Sprint payoffs are version-stable: their frozen
 *      dollar outcome is re-emitted verbatim, never recomputed.
 *
 * Self-healing and idempotent: same facts + same version → byte-identical ledger on
 * any number of runs; a stale/partial projection re-converges on the next run. A
 * failed READ aborts before any write, leaving the prior projection intact.
 */
export async function settleUser(userId: string): Promise<SettleResult> {
  const supabase = createServiceClient();

  // ── Phase 1: CHEAP reads only (no habit_logs, no frozen snapshots, no sprint
  // closes). These bound-independent reads let us decide whether any work is due
  // before paying for the volume that grows with account age. settled_weeks is read
  // as indices + ends only (one small row per settled week — the trailing-window
  // anchor), NOT its full frozen `positions` snapshot.
  const [settingsRes, habitsRes, settledIdxRes, versionGapRes, habitWeekKeysRes] =
    await Promise.all([
      // FROZEN settlement anchors (migration 0036) — never the live, browser-synced
      // timezone/week_start. The week grid indexes immutable frozen facts, so its
      // inputs must be immutable too; the anchors lock at the first frozen fact.
      supabase
        .from('user_settings')
        .select('settlement_timezone, settlement_week_start, signup_local_date')
        .eq('user_id', userId)
        .single(),
      supabase
        .from('habits')
        .select(
          'id, kind, cadence, area, status, created_at, term_started_on, recurrence_rule, archived_at, graduated_at',
        )
        .eq('user_id', userId),
      supabase.from('settled_weeks').select('week_index, week_end').eq('user_id', userId),
      // Version gap: any HABIT-settlement ledger row under an OLDER scoring version.
      // Its presence triggers a REPLAY (recompute + replace) — NOT a throw — so the
      // projection self-heals to the current constants. Sprint rows are excluded
      // (version-stable).
      supabase
        .from('price_ledger')
        .select('scoring_version')
        .eq('user_id', userId)
        .in('event_type', ['habit_week_settled', 'streak_bonus', 'recovery_bonus', 'collapse_penalty'])
        .lt('scoring_version', SCORING_VERSION)
        .limit(1),
      // Orphan self-heal: the habit_week ledger keys present. Every non-empty settled
      // week books exactly one `habit_week:{i}` row, so a frozen week whose row is
      // missing (a concurrency-orphaned replay) must re-enter the replay branch below.
      supabase
        .from('price_ledger')
        .select('settlement_key')
        .eq('user_id', userId)
        .eq('event_type', 'habit_week_settled'),
    ]);

  // Every read must succeed before we touch the ledger: a transient error returns
  // null data, which would otherwise rebuild the projection from a partial view of
  // the facts. Abort and leave the prior projection intact. (settings may be
  // legitimately absent pre-signup — handled just below.)
  // settings uses `.single()`, which returns PGRST116 when the row is
  // legitimately absent (signup not finished) — tolerate that, but a REAL transient
  // error must abort, not be mistaken for "no settings" and silently skip settlement.
  const settingsErr = settingsRes.error && settingsRes.error.code !== 'PGRST116';
  if (
    habitsRes.error ||
    settledIdxRes.error ||
    versionGapRes.error ||
    habitWeekKeysRes.error ||
    settingsErr
  ) {
    console.error(
      'settleUser: read failed',
      habitsRes.error?.code ??
        settledIdxRes.error?.code ??
        versionGapRes.error?.code ??
        habitWeekKeysRes.error?.code ??
        settingsRes.error?.code,
    );
    throw new Error('settlement_read_failed');
  }

  const settings = settingsRes.data;
  // Missing settings (e.g. signup not finished) → skip settlement, no harm.
  if (!settings) return { weeksSettled: 0, eventsBooked: 0 };

  const tz = settings.settlement_timezone;
  const signupLocal = settings.signup_local_date as LocalDate;
  const currentLocal = localDateInTz(new Date(), tz);
  const habitRows = (habitsRes.data ?? []) as HabitRow[];

  const existingIdx = new Set((settledIdxRes.data ?? []).map((r) => r.week_index));
  // Trailing-window cutoff: the latest already-frozen week end (or signup if nothing
  // is frozen yet). Every not-yet-frozen NON-EMPTY week starts at/after this — new
  // weeks only ever accrue at the leading edge, and each settlement freezes ALL of
  // them atomically, so no non-empty week below the cutoff is ever left unfrozen.
  // Older frozen weeks are replayed from their snapshots, never rebuilt from logs.
  //
  // INVARIANT this relies on: a habit's participation in an OLD week can never grow
  // retroactively. Holds because created_at is always now() (no backdating) and status
  // only goes active→retired (no un-retire path). If a future feature adds habit
  // reactivation, a backdated created_at, or a historical import, revisit this bound —
  // it could otherwise skip building an old week that newly gained a member.
  const maxFrozenEnd = (settledIdxRes.data ?? []).reduce<LocalDate | null>(
    (mx, r) => (mx === null || compareLocalDate(r.week_end, mx) > 0 ? (r.week_end as LocalDate) : mx),
    null,
  );
  const cutoff = maxFrozenEnd ?? signupLocal;

  // ── Detect new weeks WITHOUT reading logs. A week's roster membership (and so
  // whether it books anything) depends only on habit creation dates, never on logs —
  // so an empty-log skeleton materializes exactly the same set of weeks with the same
  // positions.length. Any past-grace, non-empty week not already frozen is new work.
  const skeleton = buildWeeks(signupLocal, currentLocal, settings.settlement_week_start, tz, habitRows, [], cutoff);
  const hasNewWeek = skeleton.complete.some(
    (w) => !existingIdx.has(w.weekIndex) && w.positions.length > 0,
  );
  const versionGap = (versionGapRes.data ?? []).length > 0;

  // Orphan: a frozen week (in settled_weeks) with no habit_week ledger row — a replay
  // that a concurrent settle stepped on, leaving the freeze without its valuation. The
  // short-circuit must NOT skip it; re-entering the replay branch re-derives the row.
  const ledgerWeekIdx = new Set(
    (habitWeekKeysRes.data ?? [])
      .map((r) => Number(String(r.settlement_key).slice('habit_week:'.length)))
      .filter((n) => Number.isInteger(n)),
  );
  const hasOrphan = [...existingIdx].some((i) => !ledgerWeekIdx.has(i));

  // ── SHORT-CIRCUIT: nothing new to freeze, no version bump to replay, and no orphaned
  // week → the projection is already current. Return before the expensive reads (full
  // habit_logs, the frozen snapshots, sprint closes) and the replay RPC. This is the
  // common case on almost every page load, and it now costs only the small Phase-1 reads.
  if (!hasNewWeek && !versionGap && !hasOrphan) {
    return { weeksSettled: existingIdx.size, eventsBooked: 0 };
  }

  // Retry-once wrapper for the concurrency guard: if a parallel settle froze a newer
  // week between our Phase-2 read and the RPC, the RPC raises `replay_stale` and we
  // re-read Phase-2 (now seeing that week) + recompute + re-call. The advisory lock in
  // the RPC serializes the writes; this guards against a payload computed from a stale
  // read. Idempotent, so the retry lands the same rows.
  for (let attempt = 0; attempt < 2; attempt++) {
  // ── Phase 2: the volume reads, paid ONLY when there is real work. habit_logs is
  // bounded to the trailing window (>= cutoff): logs for already-frozen weeks are
  // never needed — those weeks replay from their snapshots below.
  const [logsRes, settledRes, closesRes] = await Promise.all([
    supabase
      .from('habit_logs')
      .select('habit_id, status, local_date')
      .eq('user_id', userId)
      .gte('local_date', cutoff),
    // The frozen per-week facts already recorded — the snapshot source for replay.
    supabase
      .from('settled_weeks')
      .select('week_index, week_start, week_end, days_in_week, positions')
      .eq('user_id', userId),
    // The frozen sprint-close facts — re-emitted into the ledger verbatim.
    supabase
      .from('sprint_closes')
      .select('sprint_id, frozen_basis_cents, realized_pct, realized_amount_cents, area, closed_local_date, metadata')
      .eq('user_id', userId),
  ]);
  if (logsRes.error || settledRes.error || closesRes.error) {
    console.error(
      'settleUser: phase-2 read failed',
      logsRes.error?.code ?? settledRes.error?.code ?? closesRes.error?.code,
    );
    throw new Error('settlement_read_failed');
  }

  // Rebuild the trailing window with REAL logs (same cutoff → same week set as the
  // skeleton, now with true completions). Only weeks at/after the cutoff are built;
  // older weeks come from their frozen snapshots.
  const { complete } = buildWeeks(
    signupLocal,
    currentLocal,
    settings.settlement_week_start,
    tz,
    habitRows,
    (logsRes.data ?? []) as LogRow[],
    cutoff,
  );

  // ── 1. Freeze facts for newly-elapsed (past-grace) weeks not yet recorded.
  // Empty-roster weeks are skipped — nothing to score OR freeze (mirrors the
  // empty-week skip in foldSettlements; avoids locking dates a user never tracked).
  //
  // Filter against the PHASE-2 snapshot set (`frozenIdx`), NOT the Phase-1
  // `existingIdx`. If a concurrent settleUser froze a week between our two reads,
  // that week is already in `settledRes` (→ factWeeks below); filtering `newWeeks`
  // by the stale Phase-1 set would re-add it, duplicating its settlement_key and
  // tripping the ledger's unique constraint inside the replay RPC. Deriving both
  // `newWeeks` and `factWeeks` from the same `settledRes` read keeps them disjoint.
  const frozenIdx = new Set((settledRes.data ?? []).map((r) => r.week_index));
  const newWeeks = complete.filter(
    (w) => !frozenIdx.has(w.weekIndex) && w.positions.length > 0,
  );
  // The snapshot rows to freeze. NOT written here separately — they are passed into
  // replay_user_projection and inserted (write-once, on-conflict-do-nothing) inside
  // the SAME transaction as the ledger swap (migration 0031). Freeze + valuation are
  // therefore atomic: a failed replay rolls the freeze back too, so the next load
  // re-detects these weeks as new and retries the whole unit — no orphaned freeze that
  // the short-circuit would then skip re-deriving.
  const newWeekFactRows = newWeeks.map((w) => ({
    week_index: w.weekIndex,
    week_start: w.weekStart,
    week_end: w.weekEnd,
    days_in_week: w.daysInWeek,
    positions: w.positions,
  }));

  // All frozen week snapshots = those already recorded + those just frozen. The
  // recorded ones are used VERBATIM (immune to later roster/tz edits); only the
  // constants are re-applied by foldSettlements.
  const factWeeks: WeekInput[] = [
    ...(settledRes.data ?? []).map((r) => ({
      weekIndex: r.week_index,
      weekStart: r.week_start as LocalDate,
      weekEnd: r.week_end as LocalDate,
      daysInWeek: r.days_in_week,
      positions: (r.positions ?? []) as unknown as PositionWeekInput[],
    })),
    ...newWeeks,
  ].sort((a, b) => a.weekIndex - b.weekIndex);

  const events = foldSettlements(factWeeks);
  const habitLedgerRows = events.map((e) => ({
    event_type: e.eventType,
    settlement_key: e.settlementKey,
    amount_cents: e.amountCents,
    pct: e.pct,
    basis_cents: e.basisCents,
    scoring_version: SCORING_VERSION,
    occurred_at: `${e.weekEnd}T12:00:00Z`,
    metadata: e.metadata ?? {},
  }));

  // Sprint payoffs: re-emit the FROZEN dollar outcome verbatim (version-stable), and
  // attribute each to its close-week for the board statement.
  const closes = closesRes.data ?? [];
  const sprintLedgerRows = closes.map((c) => ({
    event_type: 'sprint_realized' as const,
    settlement_key: settlementKey.sprintRealized(c.sprint_id),
    amount_cents: c.realized_amount_cents,
    pct: c.realized_pct,
    basis_cents: c.frozen_basis_cents,
    scoring_version: SCORING_VERSION,
    occurred_at: `${c.closed_local_date}T12:00:00Z`,
    metadata: (c.metadata ?? {}) as Record<string, unknown>,
  }));
  const attributedSprints = attributeSprintsToWeeks(
    closes.map((c) => ({
      amountCents: c.realized_amount_cents,
      localDate: c.closed_local_date as LocalDate,
      area: c.area,
    })),
    factWeeks,
  );

  const statements = buildWeekStatements([...events, ...attributedSprints]);
  const boardRows = statements.map((s) => ({
    week_index: s.weekIndex,
    closing_value_cents: s.closingCents,
    week_delta_cents: s.deltaCents,
    area_contributions: s.areaCents,
    settled_at: `${s.weekEnd}T12:00:00Z`,
  }));

  const ledgerRows = [...habitLedgerRows, ...sprintLedgerRows];

  // ── 3. Atomic freeze + swap in ONE transaction (migration 0031): the RPC first
  // inserts the new settled_weeks snapshots (write-once), then delete+reinserts the
  // rebuildable ledger rows and updates board_meetings in place. All-or-nothing, so a
  // mid-replay failure can never leave a mixed-version ledger OR an orphaned freeze.
  // The max settled week the caller OBSERVED (Phase-2 snapshot set, disjoint from
  // newWeeks). The RPC rejects (replay_stale) if a concurrent freeze advanced past this.
  const observedMaxWeek = frozenIdx.size === 0 ? null : Math.max(...frozenIdx);
  const { error: replayErr } = await supabase.rpc('replay_user_projection', {
    p_user_id: userId,
    p_ledger_rows: ledgerRows as never,
    p_board_rows: boardRows as never,
    p_settled_weeks: newWeekFactRows as never,
    p_observed_max_week: observedMaxWeek as never,
    p_scoring_version: SCORING_VERSION as never,
  });
  if (replayErr) {
    // A stale read lost the race → re-read Phase-2 + recompute once. Any other error,
    // or a second stale, is fatal.
    if (replayErr.message?.includes('replay_stale') && attempt === 0) continue;
    console.error('settleUser: replay_user_projection failed', replayErr.code);
    throw new Error('settlement_failed');
  }

  // weeksSettled reports the total frozen-fact count (already-frozen + just-frozen),
  // not the bounded trailing window `complete.length`, so it stays a stable all-time
  // figure regardless of the read-bounding above. Uses the Phase-2 `frozenIdx` (the
  // set `newWeeks` is disjoint from) so the count can't double-count a raced freeze.
  return { weeksSettled: frozenIdx.size + newWeeks.length, eventsBooked: ledgerRows.length };
  }
  // Unreachable: the loop either returns on success or throws; the retry `continue`
  // only happens on attempt 0. A terminal throw keeps the function's return type honest.
  throw new Error('settlement_failed');
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
  /** WoW: the CURRENT week's live movement so far (excludes any pending grace week). */
  weekDeltaCents: number;
  /** DoD: today's live movement (current-week mark today − current-week mark end of yesterday). */
  dayDeltaCents: number;
  /**
   * The just-closed week awaiting settlement, shown only during its grace day
   * (Home: "last week settles tonight — still editable"). Its `markCents` is already
   * folded into `provisionalCents`/`displayedCents`; null outside the grace window.
   */
  pendingSettlement: { weekEnd: LocalDate; markCents: number } | null;
  /** Active roster as position rows, ordered as read (created_at asc upstream). */
  positions: HomePosition[];
  /**
   * Per-region cumulative level in cents for Home's RPG map: each life area's settled
   * board-statement contribution + the current week's provisional (positions grouped
   * by area) + the active sprint's live unrealized return on its target region.
   * Habits/sprints with no area are excluded (they move the total, not a region).
   * Server-derived here so Home is a pure consumer (no divergent client re-derivation).
   */
  regionLevels: Record<RegionArea, number>;
  /**
   * False when the board_meetings read (the settled per-area source) failed, so
   * `regionLevels` holds only the current-week provisional and would UNDER-report the
   * hero. Home treats this like "value unavailable" rather than render wrong region
   * levels — matching the pre-engine page, which failed closed on its own board read.
   * (The operating value itself never depends on this read, so other callers ignore it.)
   */
  regionLevelsReliable: boolean;
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
    habitsRes,
    logsRes,
    ledgerRes,
    boardRes,
    sprintsRes,
    tasksRes,
  ] = await Promise.all([
      // FROZEN settlement anchors (0036). Everything below — the provisional week,
      // deltas, intraday windowing, position day-math — runs on the same clock the
      // settled facts were graded on, so the live (display-only) timezone can never
      // put the provisional week on a different grid than the frozen ones.
      supabase
        .from('user_settings')
        .select('settlement_timezone, settlement_week_start, signup_local_date')
        .eq('user_id', userId)
        .single(),
      supabase
        .from('habits')
        .select(
          'id, kind, cadence, area, status, created_at, term_started_on, recurrence_rule, title, term_days, archived_at, graduated_at',
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
        .select('week_index, closing_value_cents, settled_at, area_contributions')
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
  // `.single()` returns an error when no row exists; settings may legitimately
  // be absent (signup not finished), so it is allowed to be null (PGRST116).
  const settingsErr = settingsRes.error && settingsRes.error.code !== 'PGRST116';
  if (ledgerRes.error || habitsRes.error || logsRes.error || settingsErr) {
    console.error(
      'getOperatingState: read failed',
      ledgerRes.error?.code ??
        habitsRes.error?.code ??
        logsRes.error?.code ??
        settingsRes.error?.code,
    );
    throw new Error('operating_value_read_failed');
  }
  const settings = settingsRes.data;
  const habits = habitsRes.data;
  const logs = logsRes.data;
  const realizedCents = operatingValueCents((ledgerRes.data ?? []).map((r) => r.amount_cents));

  // Operating value never DISPLAYS negative (founder ruling). This is a presentation
  // clamp on the emitted value/chart fields ONLY — the ledger/fold stays a true fact
  // projection (realizedCents/provisionalCents below are unfloored), and signed deltas
  // stay signed (a down week must still read red). Applied to displayedCents, the
  // intraday points + open, and the trend closings so the chart can't dip below 0.
  const floorValue = (c: number) => Math.max(0, c);

  const tz = settings?.settlement_timezone ?? null;
  const today = tz ? localDateInTz(new Date(), tz) : null;

  let provisionalCents = 0;
  let weekDeltaCents = 0;
  let dayDeltaCents = 0;
  let pendingSettlement: { weekEnd: LocalDate; markCents: number } | null = null;
  let positions: HomePosition[] = [];
  let intraday: IntradayToday = { dayOpenCents: floorValue(realizedCents), points: [], localDate: today ?? '' };
  if (settings && tz && today) {
    const signupLocal = settings.signup_local_date as LocalDate;
    const habitRows = (habits ?? []) as HabitRow[];
    const logRows = (logs ?? []) as LogRow[];
    // Trailing-window cutoff for every buildWeeks call below: only the current and
    // pending (grace) weeks matter for the provisional value + intraday, so we never
    // rebuild older weeks. Start one calendar week before today's week to always cover
    // the pending week (the just-closed one). Bounds the repeated builds (incl. the
    // per-window-log intraday loop) to O(1–2 weeks) instead of O(account age).
    const graceFrom = addDays(weekStartOf(today, settings.settlement_week_start), -7);
    const { current, pending } = buildWeeks(signupLocal, today, settings.settlement_week_start, tz, habitRows, logRows, graceFrom);

    // The just-closed week still inside its grace window (only on the grace day):
    // scored as a full week but NOT yet booked, so its mark shows provisionally
    // beside the current week ("last week settles tonight"). Editable until it
    // settles, so it's recomputed fresh each load. The value floor today builds on
    // is realized + this pending mark (pending is constant across today).
    const pendingMark = pending ? provisionalMarkCents(pending.positions) : 0;
    const priorFloorCents = realizedCents + pendingMark;
    if (pending) pendingSettlement = { weekEnd: pending.weekEnd, markCents: pendingMark };

    // Per-position contribution for THIS week. A habit created mid-week isn't
    // scored yet (buildWeeks excludes it), so it simply maps to 0 here.
    const contribByHabit = new Map<string, number>();
    let currentMark = 0;
    if (current) {
      currentMark = provisionalMarkCents(current.positions);
      for (const c of provisionalMarkByPosition(current.positions)) {
        contribByHabit.set(c.habitId, c.cents);
      }
    }
    // Total unbooked mark = this week + any pending (grace) week. WoW movement is
    // THIS week only (the pending week's gain belongs to last week).
    provisionalCents = currentMark + pendingMark;
    weekDeltaCents = currentMark;

    // DoD: today's movement = this week's mark now − this week's mark as of end of
    // yesterday. Computed within the current week only; before the week's start it's
    // the full current mark (the week's whole gain happened since it opened). The
    // pending week is excluded — its days are all in the past, not "today".
    if (current && compareLocalDate(addDays(today, -1), current.weekStart) >= 0) {
      const builtY = buildWeeks(signupLocal, addDays(today, -1), settings.settlement_week_start, tz, habitRows, logRows, graceFrom);
      dayDeltaCents =
        builtY.current && builtY.current.weekStart === current.weekStart
          ? currentMark - provisionalMarkCents(builtY.current.positions)
          : // Yesterday was in a prior week → today is the week's first day.
            currentMark;
    } else {
      dayDeltaCents = currentMark;
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
    const builtOpen = buildWeeks(signupLocal, today, settings.settlement_week_start, tz, habitRows, priorLogs, graceFrom);
    const dayOpenCents = floorValue(
      priorFloorCents + (builtOpen.current ? provisionalMarkCents(builtOpen.current.positions) : 0),
    );
    const points: IntradayPoint[] = [];
    for (let k = 1; k <= windowLogs.length; k++) {
      const subset = [...priorLogs, ...windowLogs.slice(0, k)];
      const builtK = buildWeeks(signupLocal, today, settings.settlement_week_start, tz, habitRows, subset, graceFrom);
      const provK = builtK.current ? provisionalMarkCents(builtK.current.positions) : 0;
      const m = minuteOfDayInTz(windowLogs[k - 1].occurred_at!, tz);
      points.push({
        minuteSince6am: minutesSince6am(m),
        valueCents: floorValue(priorFloorCents + provK),
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
    .map((r) => ({ weekEnd: String(r.settled_at).slice(0, 10), closingCents: floorValue(r.closing_value_cents) }));
  if (today) series.push({ weekEnd: today, closingCents: floorValue(realizedCents + provisionalCents) });

  const sprints = buildHomeSprints(
    (sprintsRes.error ? [] : (sprintsRes.data ?? [])) as SprintRow[],
    (tasksRes.error ? [] : (tasksRes.data ?? [])) as SprintTaskRow[],
    today,
    tz,
  );

  // ── Region levels for Home's RPG map (moved here from the page so Home is a pure
  // consumer). Three parts: settled per-area contributions (every board statement),
  // + this week's provisional (positions grouped by area), + the active sprint's live
  // unrealized return on its target region. The active sprint's realized payoff hands
  // off to the settled side when its close-week settles, so there's no double-count.
  const regionLevels: Record<RegionArea, number> = { health: 0, wealth: 0, relationships: 0 };
  for (const r of boardRes.error ? [] : (boardRes.data ?? [])) {
    const contrib = r.area_contributions;
    if (contrib && typeof contrib === 'object') {
      for (const a of REGION_AREAS) {
        const v = (contrib as Record<string, unknown>)[a];
        if (typeof v === 'number' && Number.isFinite(v)) regionLevels[a] += v;
      }
    }
  }
  for (const p of positions) {
    if (p.area === 'health' || p.area === 'wealth' || p.area === 'relationships') {
      regionLevels[p.area] += p.contribCents;
    }
  }
  const activeSprint = sprints.active;
  if (
    activeSprint &&
    (activeSprint.area === 'health' ||
      activeSprint.area === 'wealth' ||
      activeSprint.area === 'relationships')
  ) {
    regionLevels[activeSprint.area] += activeSprint.unrealizedReturnCents ?? 0;
  }

  return {
    realizedCents,
    provisionalCents,
    displayedCents: floorValue(realizedCents + provisionalCents),
    baselineCents: BASELINE_CENTS,
    weekDeltaCents,
    dayDeltaCents,
    pendingSettlement,
    positions,
    regionLevels,
    regionLevelsReliable: !boardRes.error,
    series,
    intraday,
    sprints,
  };
}

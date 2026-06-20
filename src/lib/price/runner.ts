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

import { createServiceClient } from '@/lib/supabase/service';
import { SCORING_VERSION } from './config';
import {
  addDays,
  compareLocalDate,
  diffDays,
  localDateInTz,
  weekStartOf,
  type LocalDate,
} from './dates';
import { operatingValueCents } from './engine';
import { scheduledOccurrences, type RecurrenceRule } from './recurrence';
import {
  foldSettlements,
  provisionalMarkCents,
  type Area,
  type PositionRole,
  type PositionWeekInput,
  type WeekInput,
} from './settlement';

export interface HabitRow {
  id: string;
  kind: string;
  cadence: string | null;
  area: string | null;
  status: string;
  created_at: string;
  term_started_on: string | null;
  recurrence_rule: unknown;
}
export interface LogRow {
  habit_id: string;
  status: string;
  local_date: string;
}

function roleOf(h: HabitRow): PositionRole | null {
  if (h.kind === 'liability') return 'vice';
  if (h.kind === 'asset') return h.cadence === 'weekly' ? 'weekly' : 'daily';
  return null;
}

function parseRule(raw: unknown): RecurrenceRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.type === 'weekdays' && Array.isArray(r.days)) {
    return { type: 'weekdays', days: r.days.map(Number) };
  }
  if (r.type === 'every_n_days' && typeof r.n === 'number' && typeof r.anchor === 'string') {
    return { type: 'every_n_days', n: r.n, anchor: r.anchor };
  }
  return null;
}

/** Build one habit's aggregated outcome for the week's scored range. */
function buildPosition(
  h: HabitRow,
  role: PositionRole,
  logs: LogRow[],
  rangeStart: LocalDate,
  rangeEnd: LocalDate,
  daysInWeek: number,
): PositionWeekInput {
  const inRange = (d: string) =>
    compareLocalDate(d, rangeStart) >= 0 && compareLocalDate(d, rangeEnd) <= 0;
  const mine = logs.filter((l) => l.habit_id === h.id && inRange(l.local_date));
  const area = (h.area as Area | null) ?? null;

  if (role === 'vice') {
    const relapseDays = mine.filter((l) => l.status === 'relapse').length;
    return { habitId: h.id, role, area, completed: daysInWeek - relapseDays, failed: relapseDays, scheduled: daysInWeek };
  }
  if (role === 'daily') {
    const doneDays = mine.filter((l) => l.status === 'done').length;
    return { habitId: h.id, role, area, completed: doneDays, failed: daysInWeek - doneDays, scheduled: daysInWeek };
  }
  // weekly: scheduled occurrences from the recurrence rule (default 1/week).
  const rule = parseRule(h.recurrence_rule);
  const scheduled = rule ? scheduledOccurrences(rule, rangeStart, rangeEnd) : 1;
  const doneCount = mine.filter((l) => l.status === 'done').length;
  const completed = Math.min(doneCount, scheduled);
  return { habitId: h.id, role, area, completed, failed: Math.max(scheduled - completed, 0), scheduled };
}

interface BuiltWeeks {
  complete: WeekInput[];
  current: WeekInput | null;
}

/** Assemble settlement weeks from signup to now, splitting complete vs in-progress. */
export function buildWeeks(
  signupLocal: LocalDate,
  currentLocal: LocalDate,
  weekStart: number,
  timezone: string,
  habits: HabitRow[],
  logs: LogRow[],
): BuiltWeeks {
  const firstWeekStart = weekStartOf(signupLocal, weekStart);
  const complete: WeekInput[] = [];
  let current: WeekInput | null = null;

  for (let i = 0; ; i++) {
    const wkStart = addDays(firstWeekStart, i * 7);
    const wkEnd = addDays(wkStart, 6);
    if (compareLocalDate(wkStart, currentLocal) > 0) break; // future week

    const isComplete = compareLocalDate(wkEnd, currentLocal) < 0;
    // Week 0 is pro-rata from signup. The in-progress week counts ONLY through
    // today — never the days that haven't happened yet, so the provisional mark
    // reflects what's actually been done so far.
    const rangeStart = i === 0 && compareLocalDate(signupLocal, wkStart) > 0 ? signupLocal : wkStart;
    const rangeEnd = isComplete ? wkEnd : currentLocal;
    const daysInWeek = diffDays(rangeEnd, rangeStart) + 1;

    const positions = habits
      .filter((h) => {
        if (h.status !== 'active') return false;
        // A habit participates only if it existed by the scored range's start;
        // a habit created mid-week is never charged for days before it existed.
        const habitStart = localDateInTz(new Date(h.created_at), timezone);
        return compareLocalDate(habitStart, rangeStart) <= 0;
      })
      .map((h) => {
        const role = roleOf(h)!;
        return buildPosition(h, role, logs, rangeStart, rangeEnd, daysInWeek);
      });

    const wk: WeekInput = { weekIndex: i, weekStart: wkStart, weekEnd: wkEnd, daysInWeek, positions };

    if (isComplete) {
      complete.push(wk); // fully elapsed → settleable
    } else {
      current = wk; // in progress → provisional only
      break;
    }
  }
  return { complete, current };
}

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

  return { weeksSettled: complete.length, eventsBooked: rows.length };
}

export interface OperatingState {
  realizedCents: number;
  provisionalCents: number;
  displayedCents: number;
}

/**
 * The Home operating value: the realized ledger fold plus the current week's
 * provisional (unbooked) habit mark. Settles any elapsed weeks first.
 */
export async function getOperatingState(userId: string): Promise<OperatingState> {
  await settleUser(userId);
  const supabase = createServiceClient();

  const [{ data: settings }, { data: profile }, { data: habits }, { data: logs }, ledgerRes] =
    await Promise.all([
      supabase.from('user_settings').select('timezone, week_start').eq('user_id', userId).single(),
      supabase.from('user_profiles').select('created_at').eq('id', userId).single(),
      supabase
        .from('habits')
        .select('id, kind, cadence, area, status, created_at, term_started_on, recurrence_rule')
        .eq('user_id', userId),
      supabase.from('habit_logs').select('habit_id, status, local_date').eq('user_id', userId),
      supabase.from('price_ledger').select('amount_cents').eq('user_id', userId),
    ]);

  // Don't render the baseline as if the ledger were empty on a transient error.
  if (ledgerRes.error) {
    console.error('getOperatingState: ledger read failed', ledgerRes.error.code);
    throw new Error('operating_value_read_failed');
  }
  const realizedCents = operatingValueCents((ledgerRes.data ?? []).map((r) => r.amount_cents));

  let provisionalCents = 0;
  if (settings && profile) {
    const tz = settings.timezone;
    const { current } = buildWeeks(
      localDateInTz(new Date(profile.created_at), tz),
      localDateInTz(new Date(), tz),
      settings.week_start,
      tz,
      (habits ?? []) as HabitRow[],
      (logs ?? []) as LogRow[],
    );
    if (current) provisionalCents = provisionalMarkCents(current.positions);
  }

  return { realizedCents, provisionalCents, displayedCents: realizedCents + provisionalCents };
}

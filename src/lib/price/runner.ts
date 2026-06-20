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
import { SCORING_VERSION } from './config';
import { localDateInTz } from './dates';
import { operatingValueCents } from './engine';
import { foldSettlements, provisionalMarkCents, provisionalMarkByPosition } from './settlement';
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

export interface OperatingState {
  realizedCents: number;
  provisionalCents: number;
  displayedCents: number;
  /** Active roster as position rows, ordered as read (created_at asc upstream). */
  positions: HomePosition[];
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

  const [{ data: settings }, { data: profile }, { data: habits }, { data: logs }, ledgerRes] =
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
    ]);

  // Don't render the baseline as if the ledger were empty on a transient error.
  if (ledgerRes.error) {
    console.error('getOperatingState: ledger read failed', ledgerRes.error.code);
    throw new Error('operating_value_read_failed');
  }
  const realizedCents = operatingValueCents((ledgerRes.data ?? []).map((r) => r.amount_cents));

  let provisionalCents = 0;
  let positions: HomePosition[] = [];
  if (settings && profile) {
    const tz = settings.timezone;
    const today = localDateInTz(new Date(), tz);
    const { current } = buildWeeks(
      localDateInTz(new Date(profile.created_at), tz),
      today,
      settings.week_start,
      tz,
      (habits ?? []) as HabitRow[],
      (logs ?? []) as LogRow[],
    );

    // Per-position contribution for THIS week. A habit created mid-week isn't
    // scored yet (buildWeeks excludes it), so it simply maps to 0 here.
    const contribByHabit = new Map<string, number>();
    if (current) {
      provisionalCents = provisionalMarkCents(current.positions);
      for (const c of provisionalMarkByPosition(current.positions)) {
        contribByHabit.set(c.habitId, c.cents);
      }
    }

    const allLogs = (logs ?? []) as LogRow[];
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

  return {
    realizedCents,
    provisionalCents,
    displayedCents: realizedCents + provisionalCents,
    positions,
  };
}

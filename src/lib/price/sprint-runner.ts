// Sprint runner — SERVER ONLY. The DB-aware bridge for the sprint lifecycle that
// touches the append-only price_ledger (which has no user INSERT policy) and so
// must run under the service role. Mirrors price/runner.ts: pure payoff math lives
// in engine.ts; this is the thin I/O shell.
//
// SECURITY: callers MUST pass the AUTHENTICATED user's id (from
// supabase.auth.getUser()) — these run under the service role and bypass RLS, so
// every read/write is explicitly filtered by user_id.
import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';
import { getUserToday } from '@/lib/user-today';
import { SCORING_VERSION, type SprintSize } from './config';
import {
  bandFromFrozen,
  buildSprintGrid,
  sprintBandLabel,
  sprintPayoff,
  sprintRealizedCents,
  settlementKey,
  type FrozenBand,
} from './engine';
import { getOperatingState } from './runner';

export interface CreateSprintInput {
  size: SprintSize;
  area: 'health' | 'wealth' | 'relationships';
  thesis: string;
  termDays: number;
  tasks: { title: string; dueDay: number }[];
}

export interface CreateSprintResult {
  sprintId: string;
  status: 'active' | 'queued';
}

/**
 * Create a sprint. The set-time balance is FROZEN at create (the spec's finalize
 * lock = "today's balance"): we read the user's current operating value and store
 * it + the locked dollar grid on the row. If no sprint is active the new one starts
 * active; otherwise it queues behind the active one (sequential, never parallel).
 */
export async function createSprint(userId: string, input: CreateSprintInput): Promise<CreateSprintResult> {
  const supabase = createServiceClient();

  // Basis = the operating value the user sees right now ("locked at today's $X").
  // getOperatingState settles any elapsed weeks first, so the basis is current.
  const state = await getOperatingState(userId);
  const basisCents = state.displayedCents;

  // Is there an active sprint? A failed read must not look like "none active" (which
  // would wrongly activate a second sprint and trip the one-active unique index).
  const { data: active, error: activeErr } = await supabase
    .from('sprints')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (activeErr) {
    console.error('createSprint: active read failed', activeErr.code);
    throw new Error('sprint_create_read_failed');
  }
  const willActivate = !active;

  // Next queue slot (max existing + 1) when queuing behind the active sprint.
  let queuePosition: number | null = null;
  if (!willActivate) {
    const { data: lastQueued, error: qErr } = await supabase
      .from('sprints')
      .select('queue_position')
      .eq('user_id', userId)
      .eq('status', 'queued')
      .order('queue_position', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (qErr) {
      console.error('createSprint: queue read failed', qErr.code);
      throw new Error('sprint_create_read_failed');
    }
    queuePosition = (lastQueued?.queue_position ?? 0) + 1;
  }

  const now = new Date().toISOString();
  const status = willActivate ? 'active' : 'queued';

  // FREEZE the resolved % bands + goal bonus onto the row so closeSprint prices
  // against THEM, not the live config — a mid-sprint SPRINT_PAYOFF_BANDS tune can't
  // change this sprint's payout. Derived from buildSprintGrid, so the frozen bands
  // are identical to the create-time finalize preview the user saw.
  const grid = buildSprintGrid(input.size, basisCents);
  const payoffBands: FrozenBand[] = grid.bands.map((b) => ({
    upToRatio: b.upToRatio,
    label: b.label,
    pct: b.pct,
  }));

  // One transaction (sprint row + tasks) via the RPC — a task-insert failure rolls the
  // sprint insert back, so a zero-task active sprint can never orphan the active slot.
  const { data: newId, error: rpcErr } = await supabase.rpc('create_sprint_atomic', {
    p_sprint: {
      user_id: userId,
      size: input.size,
      area: input.area,
      thesis: input.thesis,
      term_days: input.termDays,
      status,
      queue_position: queuePosition,
      set_time_balance_cents: basisCents,
      scoring_version: SCORING_VERSION,
      opened_at: willActivate ? now : null,
      payoff_bands: payoffBands,
      goal_bonus_pct: grid.goalBonusPct,
    } as never,
    p_tasks: input.tasks.map((t, position) => ({ title: t.title, due_day: t.dueDay, position })) as never,
  });
  if (rpcErr || !newId) {
    // A one-active / queue-slot race lost → 23505, surfaced as a friendly 409 by the route.
    if (rpcErr?.code === '23505') {
      console.error('createSprint: slot taken', rpcErr.code);
      throw new Error('sprint_slot_taken');
    }
    console.error('createSprint: atomic create failed', rpcErr?.code);
    throw new Error('sprint_create_failed');
  }

  return { sprintId: newId as string, status };
}

export interface CloseSprintResult {
  realizedAmountCents: number;
  realizedPct: number;
  completedTasks: number;
  totalTasks: number;
  promotedSprintId: string | null;
}

/**
 * Close the active sprint and book its realized return. The realized % comes from
 * the completion ratio at close; the dollars price against the set-time balance
 * frozen at create (NOT the $200k baseline). Booking is idempotent by sprint id
 * (settlement_key sprint_realized:<id>) so a re-close can never double-book, and
 * the active-status guard rejects a second close. Promotes the next queued sprint
 * to active on success.
 */
export async function closeSprint(
  userId: string,
  sprintId: string,
  goalAchieved: boolean,
): Promise<CloseSprintResult> {
  const supabase = createServiceClient();

  const { data: sprint, error: sErr } = await supabase
    .from('sprints')
    .select('id, size, area, status, set_time_balance_cents, scoring_version, payoff_bands, goal_bonus_pct')
    .eq('user_id', userId)
    .eq('id', sprintId)
    .single();
  if (sErr || !sprint) {
    console.error('closeSprint: sprint read failed', sErr?.code);
    throw new Error('sprint_read_failed');
  }
  if (sprint.status !== 'active') {
    // Already closed/abandoned/queued → nothing to settle (idempotent no-op guard).
    throw new Error('sprint_not_active');
  }

  const { data: tasks, error: tErr } = await supabase
    .from('sprint_tasks')
    .select('done')
    .eq('user_id', userId)
    .eq('sprint_id', sprintId);
  if (tErr) {
    console.error('closeSprint: tasks read failed', tErr.code);
    throw new Error('sprint_tasks_read_failed');
  }
  const totalTasks = (tasks ?? []).length;
  const completedTasks = (tasks ?? []).filter((t) => t.done).length;

  const size = sprint.size as SprintSize;
  const basisCents = sprint.set_time_balance_cents ?? 0;
  const completionRatio = totalTasks > 0 ? Math.min(1, Math.max(0, completedTasks / totalTasks)) : 0;

  // Price against the bands FROZEN at create (Change C) so a mid-sprint config tune
  // can't move this payout. Legacy fallback: a sprint created before 0034 has no
  // frozen bands → use current config (there are none in practice; backfill was skipped).
  let bandPct: number;
  let goalBonusPct: number;
  const frozenBands = sprint.payoff_bands as FrozenBand[] | null;
  if (frozenBands && frozenBands.length > 0) {
    bandPct = bandFromFrozen(frozenBands, completionRatio).pct;
    goalBonusPct = goalAchieved ? (sprint.goal_bonus_pct ?? 0) : 0;
  } else {
    const p = sprintPayoff(size, completedTasks, totalTasks, goalAchieved);
    bandPct = p.bandPct;
    goalBonusPct = p.goalBonusPct;
  }
  const realizedPct = bandPct + goalBonusPct;
  const amountCents = sprintRealizedCents(realizedPct, basisCents);
  const band = sprintBandLabel(completionRatio);
  const payoff = { completionRatio, bandPct, goalBonusPct, realizedPct };
  const now = new Date().toISOString();
  // The close date in the user's timezone, frozen here — week attribution must not
  // re-derive it later from a (mutable) timezone. The ledger row's occurred_at is
  // pinned to noon UTC of this date so a replay re-emits it byte-identically.
  const closedLocalDate = await getUserToday(supabase, userId);
  const occurredAt = `${closedLocalDate}T12:00:00Z`;
  // Built once so the frozen fact and the projection row carry identical metadata.
  const metadata = {
    size,
    // Frozen so the settlement that attributes this payoff to a life-area region
    // reads the sprint's domain at close time (a later sprint edit can't retro-move
    // a booked payoff). Null → 'operations' on the Board.
    area: sprint.area ?? null,
    completedTasks,
    totalTasks,
    bandPct: payoff.bandPct,
    goalBonusPct: payoff.goalBonusPct,
    goalAchieved,
  };

  // Write the FROZEN close fact FIRST — it is the source of truth a future replay
  // re-emits the ledger row from (sprint payoffs are version-stable; the dollar
  // outcome never recomputes). Durable before the derived ledger row so a replay can
  // never delete a sprint payoff it can't reconstruct. Idempotent by (user, sprint).
  const { error: closeFactErr } = await supabase.from('sprint_closes').upsert(
    [
      {
        user_id: userId,
        sprint_id: sprintId,
        frozen_basis_cents: basisCents,
        tasks_done: completedTasks,
        tasks_total: totalTasks,
        goal_achieved: goalAchieved,
        area: sprint.area ?? null,
        realized_pct: payoff.realizedPct,
        realized_amount_cents: amountCents,
        closed_local_date: closedLocalDate,
        metadata: metadata as never,
      },
    ],
    { onConflict: 'user_id,sprint_id', ignoreDuplicates: true },
  );
  if (closeFactErr) {
    console.error('closeSprint: sprint_closes insert failed', closeFactErr.code);
    throw new Error('sprint_close_fact_failed');
  }

  // Book the realized return into the projection — service role (ledger has
  // SELECT-only RLS for users). Idempotent by settlement_key; a replay reproduces
  // this exact row from the fact above.
  const { error: ledgerErr } = await supabase.from('price_ledger').upsert(
    [
      {
        user_id: userId,
        event_type: 'sprint_realized',
        settlement_key: settlementKey.sprintRealized(sprintId),
        amount_cents: amountCents,
        pct: payoff.realizedPct,
        basis_cents: basisCents,
        scoring_version: SCORING_VERSION,
        occurred_at: occurredAt,
        metadata: metadata as never,
      },
    ],
    { onConflict: 'user_id,settlement_key', ignoreDuplicates: true },
  );
  if (ledgerErr) {
    console.error('closeSprint: ledger upsert failed', ledgerErr.code);
    throw new Error('sprint_close_ledger_failed');
  }

  // Record the realized outcome on the sprint. FATAL if it fails: the ledger
  // (authoritative) already committed idempotently, but leaving the sprint 'active'
  // while proceeding to promote a queued one would create two active sprints (the
  // partial unique index would then reject the promote). Throwing makes the client
  // retry the whole close — the ledger upsert no-ops on retry, then the update +
  // promotion complete. So a half-applied close self-heals instead of getting stuck.
  const { error: updErr } = await supabase
    .from('sprints')
    .update({
      status: 'closed',
      closed_at: now,
      goal_achieved: goalAchieved,
      realized_band: band,
      realized_pct: payoff.realizedPct,
      realized_amount_cents: amountCents,
    })
    .eq('user_id', userId)
    .eq('id', sprintId);
  if (updErr) {
    console.error('closeSprint: sprint update failed', updErr.code);
    throw new Error('sprint_close_update_failed');
  }

  // Promote the next queued sprint (lowest queue_position) to active.
  let promotedSprintId: string | null = null;
  const { data: next, error: nextErr } = await supabase
    .from('sprints')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'queued')
    .order('queue_position', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (nextErr) {
    console.error('closeSprint: queue read failed', nextErr.code);
  } else if (next) {
    const { error: promoteErr } = await supabase
      .from('sprints')
      .update({ status: 'active', opened_at: now, queue_position: null })
      .eq('user_id', userId)
      .eq('id', next.id);
    if (promoteErr) {
      console.error('closeSprint: promote failed', promoteErr.code);
    } else {
      promotedSprintId = next.id;
    }
  }

  return {
    realizedAmountCents: amountCents,
    realizedPct: payoff.realizedPct,
    completedTasks,
    totalTasks,
    promotedSprintId,
  };
}

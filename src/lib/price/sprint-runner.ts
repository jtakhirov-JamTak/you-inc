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
import { SCORING_VERSION, type SprintSize } from './config';
import { sprintBandLabel, sprintPayoff, sprintRealizedCents, settlementKey } from './engine';
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

  // The dollar payoff grid is derived on demand from (size, set_time_balance_cents,
  // scoring_version) via buildSprintGrid — not denormalized onto the row, so a
  // later band-table change can never leave a stale stored grid behind.
  const { data: created, error: insErr } = await supabase
    .from('sprints')
    .insert({
      user_id: userId,
      size: input.size,
      area: input.area,
      thesis: input.thesis,
      term_days: input.termDays,
      status: willActivate ? 'active' : 'queued',
      queue_position: queuePosition,
      set_time_balance_cents: basisCents,
      scoring_version: SCORING_VERSION,
      opened_at: willActivate ? now : null,
    })
    .select('id, status')
    .single();
  if (insErr || !created) {
    console.error('createSprint: insert failed', insErr?.code);
    throw new Error('sprint_create_failed');
  }

  const taskRows = input.tasks.map((t, position) => ({
    user_id: userId,
    sprint_id: created.id,
    title: t.title,
    due_day: t.dueDay,
    position,
  }));
  const { error: tasksErr } = await supabase.from('sprint_tasks').insert(taskRows);
  if (tasksErr) {
    console.error('createSprint: tasks insert failed', tasksErr.code);
    throw new Error('sprint_tasks_create_failed');
  }

  return { sprintId: created.id, status: created.status as 'active' | 'queued' };
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
    .select('id, size, status, set_time_balance_cents')
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
  const payoff = sprintPayoff(size, completedTasks, totalTasks, goalAchieved);
  const amountCents = sprintRealizedCents(payoff.realizedPct, basisCents);
  const band = sprintBandLabel(payoff.completionRatio);
  const now = new Date().toISOString();

  // Book the realized return — service role (ledger has SELECT-only RLS for users).
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
        occurred_at: now,
        metadata: {
          size,
          completedTasks,
          totalTasks,
          bandPct: payoff.bandPct,
          goalBonusPct: payoff.goalBonusPct,
          goalAchieved,
        } as never,
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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// sprint-runner.ts carries `import 'server-only'` (throws outside an RSC bundle) —
// neutralize it so we can unit-test the orchestration (CLAUDE.md server-only lesson).
vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => h.client,
}));

import { createSprint, closeSprint } from '../sprint-runner';
import { BASELINE_CENTS, SCORING_VERSION } from '../config';

// ── Fake Supabase client ─────────────────────────────────────────────────────────
// Per table, a FIFO queue of canned responses consumed by each terminal op
// (single / maybeSingle / awaited list / upsert / insert / update), in call order.
type Canned = { data?: unknown; error?: unknown };

function makeClient(responses: Record<string, Canned[]>) {
  const calls = {
    upsert: [] as { table: string; rows: unknown[]; opts: unknown }[],
    update: [] as { table: string; vals: Record<string, unknown> }[],
    insert: [] as { table: string; rows: unknown }[],
    rpc: [] as { name: string; args: Record<string, unknown> }[],
  };
  const idx: Record<string, number> = {};

  function next(table: string): Canned {
    const q = responses[table] ?? [];
    const i = idx[table] ?? 0;
    idx[table] = i + 1;
    return q[Math.min(i, q.length - 1)] ?? { data: null, error: null };
  }

  function builderFor(table: string) {
    const b = {
      select: () => b,
      eq: () => b,
      in: () => b,
      gte: () => b,
      lte: () => b,
      order: () => b,
      limit: () => b,
      // settleUser's version-guard chain (.lt(...).limit(1)); these tests don't
      // exercise it, so it always resolves empty (no stale-version rows).
      lt: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
      single: () => Promise.resolve(next(table)),
      maybeSingle: () => Promise.resolve(next(table)),
      insert: (rows: unknown) => {
        calls.insert.push({ table, rows });
        return b; // supports .select().single() and bare await
      },
      upsert: (rows: unknown[], opts: unknown) => {
        const r = next(table);
        calls.upsert.push({ table, rows, opts });
        return Promise.resolve({ error: r.error ?? null });
      },
      update: (vals: Record<string, unknown>) => {
        calls.update.push({ table, vals });
        const u = {
          eq: () => u,
          then: (res: (v: Canned) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(next(table)).then(res, rej),
        };
        return u;
      },
      then: (res: (v: Canned) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(next(table)).then(res, rej),
    };
    return b;
  }

  // RPC responses are keyed as `rpc:<name>` in the responses map.
  function rpc(name: string, args: Record<string, unknown>) {
    calls.rpc.push({ name, args });
    return Promise.resolve(next(`rpc:${name}`));
  }

  return { client: { from: builderFor, rpc }, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-22T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  h.client = null;
});

// Medium bands matching config (frozen onto the row at create) — closeSprint prices
// against THESE, not the live config table.
const MEDIUM_BANDS = [
  { upToRatio: 0.0, pct: -10 }, { upToRatio: 0.2, pct: -8 }, { upToRatio: 0.4, pct: -5 },
  { upToRatio: 0.5, pct: 0 }, { upToRatio: 0.7, pct: 1.5 }, { upToRatio: 0.85, pct: 5.0 },
  { upToRatio: 0.99, pct: 8.0 }, { upToRatio: 1.0, pct: 10.0 },
];

describe('closeSprint', () => {
  it('books sprint_realized against the FROZEN basis + FROZEN bands, marks closed, promotes the next queued', async () => {
    const { client, calls } = makeClient({
      sprints: [
        // 1. the active sprint read (carries the frozen bands)
        { data: { id: 's1', size: 'medium', status: 'active', set_time_balance_cents: 20_000_000, payoff_bands: MEDIUM_BANDS, goal_bonus_pct: 5 } },
        // 2. the close update
        { error: null },
        // 3. the next-queued read
        { data: { id: 's2' } },
        // 4. the promote update
        { error: null },
      ],
      // 3/4 tasks done → 0.75 → medium 71–85% band → +5.0%
      sprint_tasks: [{ data: [{ done: true }, { done: true }, { done: true }, { done: false }] }],
      price_ledger: [{ error: null }],
    });
    h.client = client;

    const res = await closeSprint('u1', 's1', false);

    // +5.0% of the frozen $200,000 basis = +$1,000.
    expect(res.realizedAmountCents).toBe(1_000_000);
    expect(res.completedTasks).toBe(3);
    expect(res.totalTasks).toBe(4);
    expect(res.promotedSprintId).toBe('s2');

    const ledger = calls.upsert.find((c) => c.table === 'price_ledger');
    expect(ledger).toBeDefined();
    const row = (ledger!.rows as Record<string, unknown>[])[0];
    expect(row.event_type).toBe('sprint_realized');
    expect(row.settlement_key).toBe('sprint_realized:s1');
    expect(row.amount_cents).toBe(1_000_000);
    expect(row.basis_cents).toBe(20_000_000);
    expect(row.scoring_version).toBe(SCORING_VERSION);
    // Idempotent: a re-close can never double-book.
    expect(ledger!.opts).toEqual({ onConflict: 'user_id,settlement_key', ignoreDuplicates: true });

    // The sprint is marked closed, and the next queued sprint is promoted to active.
    const closedUpd = calls.update.find((u) => u.vals.status === 'closed');
    expect(closedUpd).toBeDefined();
    expect(closedUpd!.vals.realized_amount_cents).toBe(1_000_000);
    const promoteUpd = calls.update.find((u) => u.vals.status === 'active');
    expect(promoteUpd).toBeDefined();

    // The FROZEN close fact is written (the replay source). Sprint payoffs are
    // version-stable: a future replay re-emits realized_amount_cents verbatim.
    const closeFact = calls.upsert.find((c) => c.table === 'sprint_closes');
    expect(closeFact).toBeDefined();
    expect(closeFact!.opts).toEqual({ onConflict: 'user_id,sprint_id', ignoreDuplicates: true });
    const fact = (closeFact!.rows as Record<string, unknown>[])[0];
    expect(fact.sprint_id).toBe('s1');
    expect(fact.realized_amount_cents).toBe(1_000_000);
    expect(fact.frozen_basis_cents).toBe(20_000_000);
    expect(fact.tasks_done).toBe(3);
    expect(fact.tasks_total).toBe(4);
    expect(fact.closed_local_date).toBe('2026-01-22');
  });

  it('REFUSES to settle a sprint that is not active — never books', async () => {
    const { client, calls } = makeClient({
      sprints: [{ data: { id: 's1', size: 'big', status: 'closed', set_time_balance_cents: 20_000_000 } }],
    });
    h.client = client;

    await expect(closeSprint('u1', 's1', false)).rejects.toThrow('sprint_not_active');
    expect(calls.upsert).toHaveLength(0);
  });

  it('with no queued sprint, promotes nothing (only the close update fires)', async () => {
    const { client, calls } = makeClient({
      sprints: [
        { data: { id: 's1', size: 'small', status: 'active', set_time_balance_cents: 20_000_000 } },
        { error: null }, // close update
        { data: null }, // no next queued
      ],
      sprint_tasks: [{ data: [{ done: true }, { done: true }] }], // 2/2 → small 100% → +7%
      price_ledger: [{ error: null }],
    });
    h.client = client;

    const res = await closeSprint('u1', 's1', false);
    expect(res.promotedSprintId).toBeNull();
    expect(res.realizedAmountCents).toBe(1_400_000); // +7% of $200k
    expect(calls.update.filter((u) => u.vals.status === 'active')).toHaveLength(0);
  });

  it('prices against the FROZEN bands, NOT the live config (Change C)', async () => {
    // Frozen 71–85% band = +9.0 (deliberately different from config's +5.0). 3/4 done
    // → 0.75 → the frozen +9.0 must win → +$1,800, proving config is not consulted.
    const divergent = MEDIUM_BANDS.map((b) => (b.upToRatio === 0.85 ? { ...b, pct: 9.0 } : b));
    const { client, calls } = makeClient({
      sprints: [
        { data: { id: 's1', size: 'medium', status: 'active', set_time_balance_cents: 20_000_000, payoff_bands: divergent, goal_bonus_pct: 5 } },
        { error: null }, // close update
        { data: null }, // no next queued
      ],
      sprint_tasks: [{ data: [{ done: true }, { done: true }, { done: true }, { done: false }] }],
      price_ledger: [{ error: null }],
    });
    h.client = client;

    const res = await closeSprint('u1', 's1', false);
    expect(res.realizedAmountCents).toBe(1_800_000); // +9% of $200k — frozen band, not config
    const fact = (calls.upsert.find((c) => c.table === 'sprint_closes')!.rows as Record<string, unknown>[])[0];
    expect(fact.realized_pct).toBe(9.0);
  });

  it('legacy sprint with NO frozen bands falls back to current config', async () => {
    // payoff_bands null (a pre-0034 sprint) → sprintPayoff against config. small 2/2 → +7%.
    const { client } = makeClient({
      sprints: [
        { data: { id: 's1', size: 'small', status: 'active', set_time_balance_cents: 20_000_000, payoff_bands: null, goal_bonus_pct: null } },
        { error: null },
        { data: null },
      ],
      sprint_tasks: [{ data: [{ done: true }, { done: true }] }],
      price_ledger: [{ error: null }],
    });
    h.client = client;

    const res = await closeSprint('u1', 's1', false);
    expect(res.realizedAmountCents).toBe(1_400_000); // +7% of $200k via config fallback
  });
});

describe('createSprint', () => {
  it('freezes the set-time basis at the current value and starts active when none is active', async () => {
    const { client, calls } = makeClient({
      // getOperatingState reads (settleUser + the read pass) → all empty/healthy.
      // Frozen anchors (0036): signup = today → no elapsed weeks.
      user_settings: [
        { data: { settlement_timezone: 'UTC', settlement_week_start: 0, signup_local_date: '2026-01-22' } },
        { data: { settlement_timezone: 'UTC', settlement_week_start: 0, signup_local_date: '2026-01-22' } },
      ],
      habits: [{ data: [] }, { data: [] }],
      habit_logs: [{ data: [] }, { data: [] }],
      price_ledger: [{ data: [] }], // empty ledger → operating value = baseline
      board_meetings: [{ data: [] }],
      sprints: [
        { data: [] }, // getOperatingState's active/queued list read
        { data: null }, // createSprint: no active sprint
      ],
      sprint_tasks: [
        { data: [] }, // getOperatingState's task read
      ],
      'rpc:create_sprint_atomic': [{ data: 'new1', error: null }],
    });
    h.client = client;

    const res = await createSprint('u1', {
      size: 'big',
      area: 'wealth',
      thesis: 'Ship the launch',
      termDays: 12,
      tasks: [
        { title: 'a', dueDay: 5 },
        { title: 'b', dueDay: 10 },
      ],
    });

    expect(res.sprintId).toBe('new1');
    expect(res.status).toBe('active');
    // The sprint row + tasks are inserted atomically via the RPC (no bare inserts).
    const rpc = calls.rpc.find((c) => c.name === 'create_sprint_atomic');
    expect(rpc).toBeDefined();
    const p = rpc!.args.p_sprint as Record<string, unknown>;
    // Basis frozen at the current operating value (baseline, since ledger is empty).
    expect(p.set_time_balance_cents).toBe(BASELINE_CENTS);
    expect(p.status).toBe('active');
    expect(p.opened_at).toBe('2026-01-22T12:00:00.000Z');
    expect(p.scoring_version).toBe(SCORING_VERSION);
    // The payoff bands + goal bonus are FROZEN onto the row at create (Change C).
    expect(p.goal_bonus_pct).toBe(6); // big goal bonus
    const bands = p.payoff_bands as { upToRatio: number; pct: number }[];
    expect(bands).toHaveLength(8);
    expect(bands[bands.length - 1]).toMatchObject({ upToRatio: 1.0, pct: 14.0 }); // big 100%
    expect(bands[0]).toMatchObject({ upToRatio: 0.0, pct: -14.0 }); // big 0%

    const tasks = rpc!.args.p_tasks as Record<string, unknown>[];
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ title: 'a', due_day: 5, position: 0 });
    expect(tasks[1]).toMatchObject({ title: 'b', due_day: 10, position: 1 });
  });

  it('a lost one-active/queue-slot race (23505) throws sprint_slot_taken (→ 409)', async () => {
    const { client } = makeClient({
      user_settings: [
        { data: { settlement_timezone: 'UTC', settlement_week_start: 0, signup_local_date: '2026-01-22' } },
        { data: { settlement_timezone: 'UTC', settlement_week_start: 0, signup_local_date: '2026-01-22' } },
      ],
      habits: [{ data: [] }, { data: [] }],
      habit_logs: [{ data: [] }, { data: [] }],
      price_ledger: [{ data: [] }],
      board_meetings: [{ data: [] }],
      sprints: [{ data: [] }, { data: null }],
      sprint_tasks: [{ data: [] }],
      'rpc:create_sprint_atomic': [{ data: null, error: { code: '23505' } }],
    });
    h.client = client;

    await expect(
      createSprint('u1', { size: 'small', area: 'health', thesis: 'x', termDays: 10, tasks: [] }),
    ).rejects.toThrow('sprint_slot_taken');
  });
});

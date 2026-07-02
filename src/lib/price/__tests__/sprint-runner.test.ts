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
  it('closes via ONE atomic RPC whose payload carries identical values to fact + ledger + sprint row, and promotes the next queued', async () => {
    const { client, calls } = makeClient({
      sprints: [
        // The single sprint read (carries the frozen bands) — the close update,
        // next-queued read, and promote update all moved inside the RPC (0037).
        { data: { id: 's1', size: 'medium', status: 'active', set_time_balance_cents: 20_000_000, payoff_bands: MEDIUM_BANDS, goal_bonus_pct: 5 } },
      ],
      // 3/4 tasks done → 0.75 → medium 71–85% band → +5.0%
      sprint_tasks: [{ data: [{ done: true }, { done: true }, { done: true }, { done: false }] }],
      'rpc:close_sprint_atomic': [{ data: 's2', error: null }], // RPC returns the promoted id
    });
    h.client = client;

    const res = await closeSprint('u1', 's1', false);

    // +5.0% of the frozen $200,000 basis = +$1,000.
    expect(res.realizedAmountCents).toBe(1_000_000);
    expect(res.completedTasks).toBe(3);
    expect(res.totalTasks).toBe(4);
    expect(res.promotedSprintId).toBe('s2');

    // The four sequential writes are GONE — no direct table writes, only the RPC.
    expect(calls.upsert).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
    expect(calls.insert).toHaveLength(0);

    const rpc = calls.rpc.find((c) => c.name === 'close_sprint_atomic');
    expect(rpc).toBeDefined();
    expect(rpc!.args.p_user_id).toBe('u1');
    expect(rpc!.args.p_sprint_id).toBe('s1');

    // The frozen close fact (the replay source; payoffs are version-stable).
    const close = rpc!.args.p_close as Record<string, unknown>;
    expect(close.frozen_basis_cents).toBe(20_000_000);
    expect(close.tasks_done).toBe(3);
    expect(close.tasks_total).toBe(4);
    expect(close.goal_achieved).toBe(false);
    expect(close.realized_pct).toBe(5.0);
    expect(close.realized_amount_cents).toBe(1_000_000);
    expect(close.closed_local_date).toBe('2026-01-22');

    // The ledger row carries VALUES IDENTICAL to the fact — one computation feeds
    // both (the invariant the RPC's CAS protects).
    const ledger = rpc!.args.p_ledger as Record<string, unknown>;
    expect(ledger.settlement_key).toBe('sprint_realized:s1');
    expect(ledger.amount_cents).toBe(close.realized_amount_cents);
    expect(ledger.pct).toBe(close.realized_pct);
    expect(ledger.basis_cents).toBe(close.frozen_basis_cents);
    expect(ledger.scoring_version).toBe(SCORING_VERSION);
    expect(ledger.occurred_at).toBe('2026-01-22T12:00:00Z'); // noon-UTC pin of the close date
    expect(ledger.metadata).toEqual(close.metadata); // identical snapshot on both rows
  });

  it('REFUSES to settle a sprint that is not active — never books, never calls the RPC', async () => {
    const { client, calls } = makeClient({
      sprints: [{ data: { id: 's1', size: 'big', status: 'closed', set_time_balance_cents: 20_000_000 } }],
    });
    h.client = client;

    await expect(closeSprint('u1', 's1', false)).rejects.toThrow('sprint_not_active');
    expect(calls.rpc).toHaveLength(0);
    expect(calls.upsert).toHaveLength(0);
  });

  it("maps the RPC's sprint_not_active raise (a lost CAS race) onto the same idempotent 409 path", async () => {
    // The pre-read saw 'active', but a concurrent close won the CAS before our RPC
    // landed — the RPC aborts BEFORE any fact write and the caller surfaces the
    // same error string the route already maps to 409.
    const { client } = makeClient({
      sprints: [{ data: { id: 's1', size: 'small', status: 'active', set_time_balance_cents: 20_000_000, payoff_bands: null, goal_bonus_pct: null } }],
      sprint_tasks: [{ data: [{ done: true }] }],
      'rpc:close_sprint_atomic': [{ data: null, error: { message: 'sprint_not_active', code: 'P0001' } }],
    });
    h.client = client;

    await expect(closeSprint('u1', 's1', false)).rejects.toThrow('sprint_not_active');
  });

  it('any other RPC failure throws sprint_close_failed (→ 500, client retries the whole close)', async () => {
    const { client } = makeClient({
      sprints: [{ data: { id: 's1', size: 'small', status: 'active', set_time_balance_cents: 20_000_000, payoff_bands: null, goal_bonus_pct: null } }],
      sprint_tasks: [{ data: [{ done: true }] }],
      'rpc:close_sprint_atomic': [{ data: null, error: { message: 'deadlock detected', code: '40P01' } }],
    });
    h.client = client;

    await expect(closeSprint('u1', 's1', false)).rejects.toThrow('sprint_close_failed');
  });

  it('with no queued sprint the RPC returns null → promotedSprintId null', async () => {
    const { client } = makeClient({
      sprints: [
        { data: { id: 's1', size: 'small', status: 'active', set_time_balance_cents: 20_000_000 } },
      ],
      sprint_tasks: [{ data: [{ done: true }, { done: true }] }], // 2/2 → small 100% → +7%
      'rpc:close_sprint_atomic': [{ data: null, error: null }],
    });
    h.client = client;

    const res = await closeSprint('u1', 's1', false);
    expect(res.promotedSprintId).toBeNull();
    expect(res.realizedAmountCents).toBe(1_400_000); // +7% of $200k
  });

  it('prices against the FROZEN bands, NOT the live config (Change C)', async () => {
    // Frozen 71–85% band = +9.0 (deliberately different from config's +5.0). 3/4 done
    // → 0.75 → the frozen +9.0 must win → +$1,800, proving config is not consulted.
    const divergent = MEDIUM_BANDS.map((b) => (b.upToRatio === 0.85 ? { ...b, pct: 9.0 } : b));
    const { client, calls } = makeClient({
      sprints: [
        { data: { id: 's1', size: 'medium', status: 'active', set_time_balance_cents: 20_000_000, payoff_bands: divergent, goal_bonus_pct: 5 } },
      ],
      sprint_tasks: [{ data: [{ done: true }, { done: true }, { done: true }, { done: false }] }],
      'rpc:close_sprint_atomic': [{ data: null, error: null }],
    });
    h.client = client;

    const res = await closeSprint('u1', 's1', false);
    expect(res.realizedAmountCents).toBe(1_800_000); // +9% of $200k — frozen band, not config
    const close = calls.rpc.find((c) => c.name === 'close_sprint_atomic')!.args
      .p_close as Record<string, unknown>;
    expect(close.realized_pct).toBe(9.0);
  });

  it('legacy sprint with NO frozen bands falls back to current config', async () => {
    // payoff_bands null (a pre-0034 sprint) → sprintPayoff against config. small 2/2 → +7%.
    const { client } = makeClient({
      sprints: [
        { data: { id: 's1', size: 'small', status: 'active', set_time_balance_cents: 20_000_000, payoff_bands: null, goal_bonus_pct: null } },
      ],
      sprint_tasks: [{ data: [{ done: true }, { done: true }] }],
      'rpc:close_sprint_atomic': [{ data: null, error: null }],
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

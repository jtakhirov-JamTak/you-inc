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

  return { client: { from: builderFor }, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-22T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  h.client = null;
});

describe('closeSprint', () => {
  it('books sprint_realized against the FROZEN basis, marks closed, promotes the next queued', async () => {
    const { client, calls } = makeClient({
      sprints: [
        // 1. the active sprint read
        { data: { id: 's1', size: 'medium', status: 'active', set_time_balance_cents: 20_000_000 } },
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
});

describe('createSprint', () => {
  it('freezes the set-time basis at the current value and starts active when none is active', async () => {
    const { client, calls } = makeClient({
      // getOperatingState reads (settleUser + the read pass) → all empty/healthy.
      user_settings: [
        { data: { timezone: 'UTC', week_start: 0 } },
        { data: { timezone: 'UTC', week_start: 0 } },
      ],
      user_profiles: [
        { data: { created_at: '2026-01-22T12:00:00Z' } }, // signup = now → no elapsed weeks
        { data: { created_at: '2026-01-22T12:00:00Z' } },
      ],
      habits: [{ data: [] }, { data: [] }],
      habit_logs: [{ data: [] }, { data: [] }],
      price_ledger: [{ data: [] }], // empty ledger → operating value = baseline
      board_meetings: [{ data: [] }],
      sprints: [
        { data: [] }, // getOperatingState's active/queued list read
        { data: null }, // createSprint: no active sprint
        { data: { id: 'new1', status: 'active' } }, // the insert ... returning
      ],
      sprint_tasks: [
        { data: [] }, // getOperatingState's task read
        { error: null }, // the tasks insert
      ],
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

    expect(res.status).toBe('active');
    const sprintInsert = calls.insert.find((c) => c.table === 'sprints');
    expect(sprintInsert).toBeDefined();
    const row = sprintInsert!.rows as Record<string, unknown>;
    // Basis frozen at the current operating value (baseline, since ledger is empty).
    expect(row.set_time_balance_cents).toBe(BASELINE_CENTS);
    expect(row.status).toBe('active');
    expect(row.opened_at).toBe('2026-01-22T12:00:00.000Z');
    expect(row.scoring_version).toBe(SCORING_VERSION);
    // No locked_grid denormalization — the payoff grid is derived on demand.
    expect(row).not.toHaveProperty('locked_grid');

    const taskInsert = calls.insert.find((c) => c.table === 'sprint_tasks');
    const taskRows = taskInsert!.rows as Record<string, unknown>[];
    expect(taskRows).toHaveLength(2);
    expect(taskRows[0]).toMatchObject({ title: 'a', due_day: 5, position: 0 });
    expect(taskRows[1]).toMatchObject({ title: 'b', due_day: 10, position: 1 });
  });
});

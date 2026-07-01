import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// runner.ts carries `import 'server-only'`, which throws when imported outside an
// RSC bundle (e.g. Vitest). Neutralize it so we can unit-test the orchestration.
vi.mock('server-only', () => ({}));

// The runner gets its DB handle from createServiceClient(); swap in a fake whose
// canned results we control per test. h is hoisted so the vi.mock factory (also
// hoisted) can close over it.
const h = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => h.client,
}));

import { settleUser, getOperatingState } from '../runner';
import { SCORING_VERSION } from '../config';
import { BASELINE_CENTS } from '../config';

// ── Minimal Supabase-client fake ─────────────────────────────────────────────────
// Models just the chain the runner uses:
//   from(t).select(c).eq(...).single() / .maybeSingle()      → single result
//   from(t).select(c).eq(...)            (awaited directly)    → list result
//   from(t).upsert(rows, opts)                                 → { error }
// Each table's canned result is configured up front; the builder is thenable so
// `await builder` (the no-single reads) resolves to the list result.
type Canned = { data: unknown; error: unknown };
interface TableCfg {
  // A single result, or a per-.from()-call sequence (last entry repeats) so a
  // test can make a table succeed on settleUser's read and fail on the re-read.
  list?: Canned | Canned[];
  single?: Canned;
  upsert?: { error: unknown };
  // settleUser's version-guard read (the only `.lt(...).limit(1)` chain). Kept
  // separate so it doesn't disturb the table's normal list/single reads; defaults
  // to empty (no stale-version rows → guard passes).
  versionGuard?: Canned;
}

function makeClient(cfg: Record<string, TableCfg>, rpcResult?: { error: unknown }) {
  const upsertCalls: { table: string; rows: unknown[]; opts: unknown }[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const callCounts: Record<string, number> = {};

  function builderFor(table: string) {
    const t = cfg[table] ?? {};
    const n = (callCounts[table] = (callCounts[table] ?? 0) + 1);
    const list: Canned = Array.isArray(t.list)
      ? t.list[Math.min(n - 1, t.list.length - 1)]
      : t.list ?? { data: [], error: null };
    const single: Canned = t.single ?? { data: null, error: null };
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      gte: () => builder,
      lte: () => builder,
      order: () => builder,
      // The version-guard chain: .lt(...).limit(1) resolves to the (separate)
      // versionGuard canned result, leaving the normal list/single reads untouched.
      lt: () => ({ limit: () => Promise.resolve(t.versionGuard ?? { data: [], error: null }) }),
      single: () => Promise.resolve(single),
      maybeSingle: () => Promise.resolve(single),
      upsert: (rows: unknown[], opts: unknown) => {
        upsertCalls.push({ table, rows, opts });
        return Promise.resolve(t.upsert ?? { error: null });
      },
      then: (
        resolve: (v: Canned) => unknown,
        reject: (e: unknown) => unknown,
      ) => Promise.resolve(list).then(resolve, reject),
    };
    return builder;
  }

  const client = {
    from: (table: string) => builderFor(table),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcResult ?? { error: null });
    },
  };
  return { client, upsertCalls, rpcCalls };
}

// A roster-less but otherwise-healthy account, signed up `weeksAgo` weeks back.
function healthyConfig(opts: { signup: string; ledger?: Canned }): Record<string, TableCfg> {
  return {
    user_settings: { single: { data: { timezone: 'UTC', week_start: 0 }, error: null } },
    user_profiles: { single: { data: { created_at: opts.signup }, error: null } },
    habits: { list: { data: [], error: null } },
    habit_logs: { list: { data: [], error: null } },
    price_ledger: { list: opts.ledger ?? { data: [], error: null } },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-22T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  h.client = null;
});

describe('settleUser', () => {
  it('THROWS (never books) when the roster read errors — guards a wrong settlement', async () => {
    const { client, upsertCalls } = makeClient({
      user_settings: { single: { data: { timezone: 'UTC', week_start: 0 }, error: null } },
      user_profiles: { single: { data: { created_at: '2026-01-01T12:00:00Z' }, error: null } },
      // A transient error here must abort, not settle at an empty roster.
      habits: { list: { data: null, error: { code: '57014' } } },
      habit_logs: { list: { data: [], error: null } },
    });
    h.client = client;

    await expect(settleUser('u1')).rejects.toThrow('settlement_read_failed');
    expect(upsertCalls).toHaveLength(0);
  });

  it('skips settlement (no booking) when settings/profile are missing', async () => {
    const { client, upsertCalls } = makeClient({
      user_settings: { single: { data: null, error: null } }, // signup not finished
      user_profiles: { single: { data: null, error: null } },
      habits: { list: { data: [], error: null } },
      habit_logs: { list: { data: [], error: null } },
    });
    h.client = client;

    const res = await settleUser('u1');
    expect(res).toEqual({ weeksSettled: 0, eventsBooked: 0 });
    expect(upsertCalls).toHaveLength(0);
  });

  it('REPLAYS (no throw, no reset) when the ledger holds an older scoring_version', async () => {
    // A habit-settlement row under a PRIOR version is a tuning gap. Under the
    // PROJECTION model this is NOT fatal — it triggers a REPLAY that re-derives the
    // ledger from the frozen facts under the CURRENT constants. Value is re-derived
    // from real history, never reset to baseline; the re-emitted rows carry the
    // current version (the gap closes itself).
    const cfg = healthyConfig({ signup: '2026-01-01T12:00:00Z' });
    cfg.habits = {
      list: {
        data: [
          {
            id: 'h1', kind: 'asset', cadence: 'morning', area: 'health',
            status: 'active', created_at: '2026-01-01T12:00:00Z',
            term_started_on: null, recurrence_rule: null,
          },
        ],
        error: null,
      },
    };
    cfg.price_ledger = {
      ...cfg.price_ledger,
      versionGuard: { data: [{ scoring_version: SCORING_VERSION - 1 }], error: null },
    };
    const { client, rpcCalls } = makeClient(cfg);
    h.client = client;

    await expect(settleUser('u1')).resolves.toBeDefined(); // no throw

    const replay = rpcCalls.find((c) => c.name === 'replay_user_projection');
    expect(replay).toBeDefined();
    const ledgerRows = replay!.args.p_ledger_rows as Array<Record<string, unknown>>;
    expect(ledgerRows.length).toBeGreaterThan(0);
    for (const row of ledgerRows) {
      expect(row.scoring_version).toBe(SCORING_VERSION); // gap closed
    }
  });

  it('SHORT-CIRCUITS (no replay, no freeze) when every elapsed week is already frozen and there is no version gap', async () => {
    // Signed up 3 weeks back with one active asset, and all three past-grace weeks are
    // already frozen in settled_weeks. Nothing new to freeze + no stale version → the
    // projection is current, so settleUser must return WITHOUT reading the volume data
    // or running the replay RPC (the common per-load path after the perf bounding).
    const cfg = healthyConfig({ signup: '2026-01-01T12:00:00Z' });
    cfg.habits = {
      list: {
        data: [
          {
            id: 'h1', kind: 'asset', cadence: 'morning', area: 'health',
            status: 'active', created_at: '2026-01-01T12:00:00Z',
            term_started_on: null, recurrence_rule: null,
          },
        ],
        error: null,
      },
    };
    // week_start = 0 (Sunday); signup 2026-01-01 → past-grace weeks 0/1/2 by 2026-01-22.
    cfg.settled_weeks = {
      list: {
        data: [
          { week_index: 0, week_end: '2026-01-03' },
          { week_index: 1, week_end: '2026-01-10' },
          { week_index: 2, week_end: '2026-01-17' },
        ],
        error: null,
      },
    };
    const { client, upsertCalls, rpcCalls } = makeClient(cfg);
    h.client = client;

    const res = await settleUser('u1');
    expect(res).toEqual({ weeksSettled: 3, eventsBooked: 0 });
    expect(upsertCalls).toHaveLength(0); // nothing frozen
    expect(rpcCalls.find((c) => c.name === 'replay_user_projection')).toBeUndefined(); // no rebuild
  });

  it('freezes a settled_weeks fact per new week, then rebuilds the ledger via the replay RPC', async () => {
    // Signed up 3 weeks before "now" → several complete weeks to settle. One active
    // asset so the weeks actually book (an empty roster now books nothing).
    const cfg = healthyConfig({ signup: '2026-01-01T12:00:00Z' });
    cfg.habits = {
      list: {
        data: [
          {
            id: 'h1', kind: 'asset', cadence: 'morning', area: 'health',
            status: 'active', created_at: '2026-01-01T12:00:00Z',
            term_started_on: null, recurrence_rule: null,
          },
        ],
        error: null,
      },
    };
    const { client, upsertCalls, rpcCalls } = makeClient(cfg);
    h.client = client;

    const res = await settleUser('u1');
    expect(res.weeksSettled).toBeGreaterThan(0);

    // 1. Frozen FACTS: a write-once settled_weeks row per newly-elapsed week.
    const factCall = upsertCalls.find((c) => c.table === 'settled_weeks');
    expect(factCall).toBeDefined();
    expect(factCall!.opts).toEqual({ onConflict: 'user_id,week_index', ignoreDuplicates: true });
    const factRows = factCall!.rows as Array<Record<string, unknown>>;
    expect(factRows.length).toBeGreaterThan(0);
    for (const row of factRows) {
      expect(row.user_id).toBe('u1');
      expect(typeof row.week_index).toBe('number');
      expect(Array.isArray(row.positions)).toBe(true); // the frozen snapshot
    }

    // 2. The ledger is NOT upserted directly anymore — it's rebuilt atomically by the
    //    replay_user_projection RPC (delete + reinsert in one transaction).
    expect(upsertCalls.find((c) => c.table === 'price_ledger')).toBeUndefined();
    const replay = rpcCalls.find((c) => c.name === 'replay_user_projection');
    expect(replay).toBeDefined();
    expect(replay!.args.p_user_id).toBe('u1');

    const ledgerRows = replay!.args.p_ledger_rows as Array<Record<string, unknown>>;
    expect(ledgerRows.length).toBeGreaterThan(0);
    for (const row of ledgerRows) {
      expect(row.event_type).toBe('habit_week_settled'); // one asset, no vice → only these
      expect(String(row.settlement_key)).toMatch(/^habit_week:\d+$/);
      expect(row.scoring_version).toBe(SCORING_VERSION);
      expect(String(row.occurred_at)).toMatch(/^\d{4}-\d{2}-\d{2}T12:00:00Z$/);
      expect(typeof row.amount_cents).toBe('number');
    }

    const boardRows = replay!.args.p_board_rows as Array<Record<string, unknown>>;
    expect(boardRows.length).toBeGreaterThan(0);
    for (const row of boardRows) {
      expect(typeof row.closing_value_cents).toBe('number');
      expect(typeof row.week_delta_cents).toBe('number');
      expect(String(row.settled_at)).toMatch(/^\d{4}-\d{2}-\d{2}T12:00:00Z$/);
    }
  });
});

describe('getOperatingState', () => {
  it('THROWS when the ledger read errors — never renders baseline as if empty', async () => {
    // Signup = now → settleUser books nothing, so we isolate the ledger-read error.
    const { client } = makeClient(
      healthyConfig({
        signup: '2026-01-22T12:00:00Z',
        ledger: { data: null, error: { code: '57014' } },
      }),
    );
    h.client = client;

    await expect(getOperatingState('u1')).rejects.toThrow('operating_value_read_failed');
  });

  it('THROWS when a second-batch read (habits) errors after settle succeeds', async () => {
    // habits: ok on settleUser's read (call 1), errors on getOperatingState's
    // re-read (call 2). The guard must surface it, not render a partial roster.
    const { client } = makeClient({
      user_settings: { single: { data: { timezone: 'UTC', week_start: 0 }, error: null } },
      user_profiles: { single: { data: { created_at: '2026-01-22T12:00:00Z' }, error: null } },
      habits: { list: [{ data: [], error: null }, { data: null, error: { code: '57014' } }] },
      habit_logs: { list: { data: [], error: null } },
      price_ledger: { list: { data: [], error: null } },
    });
    h.client = client;

    await expect(getOperatingState('u1')).rejects.toThrow('operating_value_read_failed');
  });

  it('folds the realized ledger into the operating value', async () => {
    const { client } = makeClient(
      healthyConfig({
        signup: '2026-01-22T12:00:00Z', // no elapsed weeks → provisional 0
        ledger: { data: [{ amount_cents: 220_000 }, { amount_cents: -20_000 }], error: null },
      }),
    );
    h.client = client;

    const state = await getOperatingState('u1');
    expect(state.realizedCents).toBe(BASELINE_CENTS + 200_000);
    expect(state.provisionalCents).toBe(0);
    expect(state.displayedCents).toBe(state.realizedCents + state.provisionalCents);
  });

  it('regionLevels sum each area\'s settled board contribution (engine-derived, not the page)', async () => {
    // signup = now → no elapsed weeks/positions, so regionLevels is purely the settled
    // per-area board contributions summed across weeks. Untouched areas stay 0.
    const cfg = healthyConfig({ signup: '2026-01-22T12:00:00Z' });
    cfg.board_meetings = {
      list: {
        data: [
          {
            week_index: 0, closing_value_cents: 20_500_000, settled_at: '2026-01-15',
            area_contributions: { health: 500_000, wealth: 200_000 },
          },
          {
            week_index: 1, closing_value_cents: 20_650_000, settled_at: '2026-01-22',
            area_contributions: { health: 100_000, relationships: 50_000 },
          },
        ],
        error: null,
      },
    };
    const { client } = makeClient(cfg);
    h.client = client;

    const state = await getOperatingState('u1');
    expect(state.regionLevels).toEqual({ health: 600_000, wealth: 200_000, relationships: 50_000 });
  });

  it('with no logs, the intraday baseline is flat and equals the displayed value', async () => {
    const { client } = makeClient(healthyConfig({ signup: '2026-01-22T12:00:00Z' }));
    h.client = client;

    const state = await getOperatingState('u1');
    expect(state.intraday.points).toEqual([]);
    expect(state.intraday.localDate).toBe('2026-01-22');
    expect(state.intraday.dayOpenCents).toBe(state.displayedCents);
  });

  it('an affirmative log today steps the intraday value up to the displayed value', async () => {
    const { client } = makeClient({
      user_settings: { single: { data: { timezone: 'UTC', week_start: 0 }, error: null } },
      user_profiles: { single: { data: { created_at: '2026-01-22T12:00:00Z' }, error: null } },
      habits: {
        list: {
          data: [
            {
              id: 'd1',
              kind: 'asset',
              cadence: 'daily',
              area: null,
              status: 'active',
              created_at: '2026-01-22T12:00:00Z',
              term_started_on: null,
              recurrence_rule: null,
              title: 'Workout',
              term_days: 14,
            },
          ],
          error: null,
        },
      },
      habit_logs: {
        list: {
          data: [
            { habit_id: 'd1', status: 'done', local_date: '2026-01-22', occurred_at: '2026-01-22T15:30:00Z' },
          ],
          error: null,
        },
      },
      price_ledger: { list: { data: [], error: null } },
    });
    h.client = client;

    const state = await getOperatingState('u1');
    // Day opened before today's completion → baseline excludes it (= realized).
    expect(state.intraday.dayOpenCents).toBe(state.realizedCents);
    // One step, landing exactly on the displayed value at 15:30 — 570 min past 6 AM.
    expect(state.intraday.points).toHaveLength(1);
    expect(state.intraday.points[0].minuteSince6am).toBe(570);
    expect(state.intraday.points[0].valueCents).toBe(state.displayedCents);
    // The completion lifted the value above the day's flat open.
    expect(state.displayedCents).toBeGreaterThan(state.intraday.dayOpenCents);
  });
});

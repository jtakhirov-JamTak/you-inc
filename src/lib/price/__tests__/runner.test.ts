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
  list?: Canned;
  single?: Canned;
  upsert?: { error: unknown };
}

function makeClient(cfg: Record<string, TableCfg>) {
  const upsertCalls: { table: string; rows: unknown[]; opts: unknown }[] = [];

  function builderFor(table: string) {
    const t = cfg[table] ?? {};
    const list: Canned = t.list ?? { data: [], error: null };
    const single: Canned = t.single ?? { data: null, error: null };
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
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

  const client = { from: (table: string) => builderFor(table) };
  return { client, upsertCalls };
}

// A roster-less but otherwise-healthy account, signed up `weeksAgo` weeks back.
function healthyConfig(opts: { signup: string; ledger?: Canned }) {
  return {
    user_settings: { single: { data: { timezone: 'UTC', week_start: 0 }, error: null } },
    user_profiles: { single: { data: { created_at: opts.signup }, error: null } },
    habits: { list: { data: [], error: null } },
    habit_logs: { list: { data: [], error: null } },
    price_ledger: { list: opts.ledger ?? { data: [], error: null } },
  } satisfies Record<string, TableCfg>;
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

  it('maps each settled week to an idempotent habit_week_settled ledger row', async () => {
    // Signed up 3 weeks before "now" → several complete weeks to settle.
    const { client, upsertCalls } = makeClient(
      healthyConfig({ signup: '2026-01-01T12:00:00Z' }),
    );
    h.client = client;

    const res = await settleUser('u1');
    expect(res.weeksSettled).toBeGreaterThan(0);
    expect(upsertCalls).toHaveLength(1);

    const call = upsertCalls[0];
    expect(call.table).toBe('price_ledger');
    // Idempotency contract: ON CONFLICT (user, settlement_key) DO NOTHING.
    expect(call.opts).toEqual({
      onConflict: 'user_id,settlement_key',
      ignoreDuplicates: true,
    });

    const rows = call.rows as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.user_id).toBe('u1');
      expect(row.event_type).toBe('habit_week_settled'); // empty roster → only these
      expect(String(row.settlement_key)).toMatch(/^habit_week:\d+$/);
      expect(row.scoring_version).toBe(SCORING_VERSION);
      // occurred_at is the week-end stamped at noon UTC (the write-lock boundary).
      expect(String(row.occurred_at)).toMatch(/^\d{4}-\d{2}-\d{2}T12:00:00Z$/);
      expect(row.amount_cents).toBe(0); // no positions → zero contribution
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
});

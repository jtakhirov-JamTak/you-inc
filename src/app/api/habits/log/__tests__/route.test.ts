// Handler test for POST /api/habits/log — the append-only Layer-1 write the whole
// price engine derives from. Pins the access ladder (origin→auth→rate-limit→
// validate→gate), the idempotent insert, the undo path, the future-date/bad-tz
// guards, and the 0011 settled-week-lock → 409 mapping (test-audit, 2026-06-22).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted control surface — each mock reads from `h` so a test can reconfigure
// origin/auth/rate-limit/DB before invoking the handler.
const h = vi.hoisted(() => ({
  originOk: true as boolean,
  auth: { data: { user: { id: "u1" } }, error: null } as unknown,
  rl: { allowed: true } as { allowed: boolean },
  client: null as unknown,
}));

vi.mock("@/lib/check-origin", () => ({ checkOrigin: () => h.originOk }));
vi.mock("@/lib/supabase/server", () => ({
  getAuthUser: () => Promise.resolve(h.auth),
  createClient: () => Promise.resolve(h.client),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => Promise.resolve(h.rl) }));
vi.mock("@sentry/nextjs", () => ({ captureException: () => {} }));

import { POST } from "../route";

const UUID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const SID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

// ── Minimal Supabase-client fake ─────────────────────────────────────────────
// habits.maybeSingle() → the gate lookup; habit_logs is terminated by .select(),
// which is awaited (thenable) → the write/delete result.
type Canned = { data: unknown; error: unknown };
function makeClient(cfg: { habit?: Canned; logResult?: Canned }) {
  const builder = (_table: string) => {
    const b: Record<string, unknown> = {};
    const ret = () => b;
    b.select = ret;
    b.eq = ret;
    b.delete = ret;
    b.upsert = ret;
    b.maybeSingle = () => Promise.resolve(cfg.habit ?? { data: null, error: null });
    b.then = (resolve: (v: Canned) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(cfg.logResult ?? { data: [], error: null }).then(resolve, reject);
    return b;
  };
  return { from: builder };
}

const ACTIVE_HABIT: Canned = { data: { id: UUID, status: "active" }, error: null };

function req(body: unknown, raw = false) {
  return new Request("https://app.test/api/habits/log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

const goodBody = { habitId: UUID, localDate: "2026-01-22", occurredTz: "UTC", sourceSessionId: SID };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-22T12:00:00Z")); // userToday (UTC) = 2026-01-22
  h.originOk = true;
  h.auth = { data: { user: { id: "u1" } }, error: null };
  h.rl = { allowed: true };
  h.client = makeClient({ habit: ACTIVE_HABIT, logResult: { data: [{ log_id: "L1" }], error: null } });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("access ladder", () => {
  it("403 when the origin check fails", async () => {
    h.originOk = false;
    expect((await POST(req(goodBody))).status).toBe(403);
  });
  it("401 when there is no authenticated user", async () => {
    h.auth = { data: { user: null }, error: null };
    expect((await POST(req(goodBody))).status).toBe(401);
  });
  it("429 when rate-limited", async () => {
    h.rl = { allowed: false };
    expect((await POST(req(goodBody))).status).toBe(429);
  });
});

describe("validation", () => {
  it("400 on invalid JSON", async () => {
    expect((await POST(req("{not json", true))).status).toBe(400);
  });
  it("400 on a schema-invalid body (bad habitId)", async () => {
    expect((await POST(req({ ...goodBody, habitId: "nope" }))).status).toBe(400);
  });
  it("400 on a bogus timezone (Intl throws)", async () => {
    expect((await POST(req({ ...goodBody, occurredTz: "Mars/Phobos" }))).status).toBe(400);
  });
  it("400 on a future-dated log", async () => {
    expect((await POST(req({ ...goodBody, localDate: "2026-01-23" }))).status).toBe(400);
  });
});

describe("gate", () => {
  it("500 when the habit lookup errors (never mistaken for not-found)", async () => {
    h.client = makeClient({ habit: { data: null, error: { code: "XX000" } } });
    expect((await POST(req(goodBody))).status).toBe(500);
  });
  it("404 when the habit does not exist / isn't the caller's", async () => {
    h.client = makeClient({ habit: { data: null, error: null } });
    expect((await POST(req(goodBody))).status).toBe(404);
  });
  it("409 when the habit is not active", async () => {
    h.client = makeClient({ habit: { data: { id: UUID, status: "retired" }, error: null } });
    expect((await POST(req(goodBody))).status).toBe(409);
  });
});

describe("log + idempotency", () => {
  it("200 created:true when a new row is inserted", async () => {
    const res = await POST(req(goodBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "done", created: true });
  });
  it("200 created:false on an idempotent no-op (row already existed)", async () => {
    h.client = makeClient({ habit: ACTIVE_HABIT, logResult: { data: [], error: null } });
    const res = await POST(req(goodBody));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, created: false });
  });
  it("409 when the insert hits the settled-week lock (0011 trigger)", async () => {
    h.client = makeClient({
      habit: ACTIVE_HABIT,
      logResult: { data: null, error: { message: 'new row ... settled_week_locked' } },
    });
    expect((await POST(req(goodBody))).status).toBe(409);
  });
  it("500 on a non-lock insert error", async () => {
    h.client = makeClient({ habit: ACTIVE_HABIT, logResult: { data: null, error: { code: "XX000" } } });
    expect((await POST(req(goodBody))).status).toBe(500);
  });
});

describe("undo", () => {
  it("200 undone:true when a row was deleted", async () => {
    h.client = makeClient({ habit: ACTIVE_HABIT, logResult: { data: [{ log_id: "L1" }], error: null } });
    const res = await POST(req({ ...goodBody, action: "undo" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, undone: true });
  });
  it("200 undone:false when nothing matched", async () => {
    h.client = makeClient({ habit: ACTIVE_HABIT, logResult: { data: [], error: null } });
    const res = await POST(req({ ...goodBody, action: "undo" }));
    expect(await res.json()).toMatchObject({ ok: true, undone: false });
  });
  it("409 when the undo hits the settled-week lock", async () => {
    h.client = makeClient({
      habit: ACTIVE_HABIT,
      logResult: { data: null, error: { message: "settled_week_locked" } },
    });
    expect((await POST(req({ ...goodBody, action: "undo" }))).status).toBe(409);
  });
});

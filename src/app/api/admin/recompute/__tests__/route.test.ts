// Handler test for POST /api/admin/recompute — the secret-gated batch replay.
// Pins the security gate (404 when the secret is unset, 401 on a missing/wrong
// Bearer), the fan-out to settleUser for every user, and partial-failure counting.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted control surface. The route imports settleUser from runner.ts (server-only)
// and createServiceClient from service.ts (server-only) — both are mocked so the
// real server-only modules are never pulled into the Vitest bundle.
const h = vi.hoisted(() => ({
  users: { data: [{ id: "u1" }, { id: "u2" }], error: null } as {
    data: unknown;
    error: unknown;
  },
  settleImpl: ((_id: string) =>
    Promise.resolve({ weeksSettled: 0, eventsBooked: 0 })) as (id: string) => Promise<unknown>,
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => Promise.resolve(h.users) }),
  }),
}));
vi.mock("@/lib/price/runner", () => ({ settleUser: (id: string) => h.settleImpl(id) }));
vi.mock("@sentry/nextjs", () => ({ captureException: () => {} }));

import { POST } from "../route";

const SECRET = "test-secret-value-1234567890";
function req(auth?: string) {
  return new Request("https://app.test/api/admin/recompute", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  h.users = { data: [{ id: "u1" }, { id: "u2" }], error: null };
  h.settleImpl = () => Promise.resolve({ weeksSettled: 0, eventsBooked: 0 });
});
afterEach(() => {
  delete process.env.ADMIN_TASK_SECRET;
});

describe("POST /api/admin/recompute — secret gate", () => {
  it("404s when ADMIN_TASK_SECRET is unset (off by omission, never open)", async () => {
    delete process.env.ADMIN_TASK_SECRET;
    const res = await POST(req("Bearer anything"));
    expect(res.status).toBe(404);
  });

  it("401s on a missing, unprefixed, or wrong Bearer secret", async () => {
    process.env.ADMIN_TASK_SECRET = SECRET;
    expect((await POST(req())).status).toBe(401); // no header
    expect((await POST(req(SECRET))).status).toBe(401); // missing "Bearer " prefix
    expect((await POST(req("Bearer wrong"))).status).toBe(401); // wrong value
  });

  it("recomputes every user when the secret matches", async () => {
    process.env.ADMIN_TASK_SECRET = SECRET;
    const seen: string[] = [];
    h.settleImpl = (id: string) => {
      seen.push(id);
      return Promise.resolve({ weeksSettled: 0, eventsBooked: 0 });
    };

    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      usersTotal: 2,
      recomputed: 2,
      failed: 0,
    });
    expect(seen).toEqual(["u1", "u2"]);
  });

  it("counts a failing user without aborting the rest of the batch", async () => {
    process.env.ADMIN_TASK_SECRET = SECRET;
    h.settleImpl = (id: string) =>
      id === "u1"
        ? Promise.reject(new Error("boom"))
        : Promise.resolve({ weeksSettled: 0, eventsBooked: 0 });

    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ usersTotal: 2, recomputed: 1, failed: 1 });
  });

  it("500s when the user list read fails (never silently recomputes nobody)", async () => {
    process.env.ADMIN_TASK_SECRET = SECRET;
    h.users = { data: null, error: { code: "57014" } };
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
  });
});

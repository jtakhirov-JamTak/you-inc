// Admin detection. isAdmin is the hot-path env-var gate used by the layout +
// any admin-gated route, so a regression that wrongly returns true would expose
// admin surfaces to a non-admin; one that wrongly returns false would lock the
// founder out of their own admin surfaces.

import { describe, it, expect, afterEach } from "vitest";
import { isAdmin } from "@/lib/admin";

const ORIGINAL_ADMIN_EMAIL = process.env.ADMIN_EMAIL;
afterEach(() => {
  if (ORIGINAL_ADMIN_EMAIL === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = ORIGINAL_ADMIN_EMAIL;
});

describe("isAdmin", () => {
  it("returns false for an undefined email", () => {
    process.env.ADMIN_EMAIL = "boss@example.com";
    expect(isAdmin(undefined)).toBe(false);
  });

  it("returns false when ADMIN_EMAIL is unset (no implicit admin)", () => {
    delete process.env.ADMIN_EMAIL;
    expect(isAdmin("boss@example.com")).toBe(false);
  });

  it("matches the configured admin email exactly", () => {
    process.env.ADMIN_EMAIL = "boss@example.com";
    expect(isAdmin("boss@example.com")).toBe(true);
  });

  it("is case-insensitive on both sides", () => {
    process.env.ADMIN_EMAIL = "Boss@Example.com";
    expect(isAdmin("BOSS@example.COM")).toBe(true);
  });

  it("rejects a non-matching email", () => {
    process.env.ADMIN_EMAIL = "boss@example.com";
    expect(isAdmin("intruder@example.com")).toBe(false);
  });
});

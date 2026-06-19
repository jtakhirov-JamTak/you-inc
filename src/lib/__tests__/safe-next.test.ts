// Open-redirect validator for the post-auth `next` param. Pins the exact set of
// bypass vectors the gate rejects — a regression here turns the auth callback
// into an open redirect (phishing handoff after a real login).

import { describe, it, expect } from "vitest";
import { safeNextPath } from "@/lib/safe-next";

describe("safeNextPath — allows safe same-site paths", () => {
  it("passes a plain absolute path through unchanged", () => {
    expect(safeNextPath("/home")).toBe("/home");
    expect(safeNextPath("/settings")).toBe("/settings");
  });

  it("preserves query strings and fragments on an internal path", () => {
    expect(safeNextPath("/home?tab=goals#top")).toBe("/home?tab=goals#top");
  });
});

describe("safeNextPath — rejects open-redirect vectors → fallback", () => {
  it("rejects a protocol-relative //host", () => {
    expect(safeNextPath("//evil.com")).toBe("/home");
    expect(safeNextPath("//evil.com/path")).toBe("/home");
  });

  it("rejects a backslash-folded /\\host (browser normalizes to a host change)", () => {
    expect(safeNextPath("/\\evil.com")).toBe("/home"); // "/\evil.com"
    expect(safeNextPath("/\\\\evil.com")).toBe("/home"); // "/\\evil.com"
    expect(safeNextPath("/path\\sub")).toBe("/home");
  });

  it("rejects an absolute URL (does not start with /)", () => {
    expect(safeNextPath("https://evil.com")).toBe("/home");
    expect(safeNextPath("http://evil.com")).toBe("/home");
  });

  it("rejects a scheme-like or relative value not starting with /", () => {
    expect(safeNextPath("javascript:alert(1)")).toBe("/home");
    expect(safeNextPath("home")).toBe("/home");
    expect(safeNextPath("")).toBe("/home");
  });

  it("rejects embedded control chars (CR/LF/tab/null)", () => {
    expect(safeNextPath("/x" + String.fromCharCode(10) + "y")).toBe("/home"); // \n
    expect(safeNextPath("/x" + String.fromCharCode(13) + "y")).toBe("/home"); // \r
    expect(safeNextPath("/x" + String.fromCharCode(9) + "y")).toBe("/home"); // \t
    expect(safeNextPath("/x" + String.fromCharCode(0) + "y")).toBe("/home"); // \0
    expect(safeNextPath("/x" + String.fromCharCode(127) + "y")).toBe("/home"); // DEL 0x7f
  });
});

describe("safeNextPath — custom fallback", () => {
  it("returns the provided fallback when the input is unsafe", () => {
    expect(safeNextPath("//evil.com", "/login")).toBe("/login");
  });

  it("does not use the fallback when the input is safe", () => {
    expect(safeNextPath("/home", "/login")).toBe("/home");
  });
});

// CSRF origin gate. Pins the Sec-Fetch-Site decision + the Origin/Host fallback
// for older browsers. A regression here either breaks legitimate same-origin
// requests (incl. <a download> navigations) or lets a cross-site page drive a
// state-changing / enumeration request.

import { describe, it, expect } from "vitest";
import { checkOrigin } from "@/lib/check-origin";

function req(headers: Record<string, string>): Request {
  return new Request("https://you-inc.vercel.app/api/x", { headers });
}

describe("checkOrigin — Sec-Fetch-Site (primary signal)", () => {
  it("accepts same-origin (page-initiated)", () => {
    expect(checkOrigin(req({ "sec-fetch-site": "same-origin" }))).toBe(true);
  });

  it("accepts none (direct user action: typed URL, bookmark)", () => {
    expect(checkOrigin(req({ "sec-fetch-site": "none" }))).toBe(true);
  });

  it("rejects same-site (subdomain — defense in depth)", () => {
    expect(checkOrigin(req({ "sec-fetch-site": "same-site" }))).toBe(false);
  });

  it("rejects cross-site (attacker's page)", () => {
    expect(checkOrigin(req({ "sec-fetch-site": "cross-site" }))).toBe(false);
  });

  it("takes precedence over Origin/Host — a forged Origin can't rescue cross-site", () => {
    expect(
      checkOrigin(
        req({
          "sec-fetch-site": "cross-site",
          origin: "https://you-inc.vercel.app",
          host: "you-inc.vercel.app",
        }),
      ),
    ).toBe(false);
  });
});

describe("checkOrigin — Origin/Host fallback (Sec-Fetch-Site absent)", () => {
  it("accepts when the Origin host matches the Host header", () => {
    expect(
      checkOrigin(
        req({ origin: "https://you-inc.vercel.app", host: "you-inc.vercel.app" }),
      ),
    ).toBe(true);
  });

  it("rejects when the Origin host differs from the Host header", () => {
    expect(
      checkOrigin(req({ origin: "https://evil.com", host: "you-inc.vercel.app" })),
    ).toBe(false);
  });

  it("rejects when Origin is missing", () => {
    expect(checkOrigin(req({ host: "you-inc.vercel.app" }))).toBe(false);
  });

  it("rejects when Host is missing", () => {
    expect(checkOrigin(req({ origin: "https://you-inc.vercel.app" }))).toBe(false);
  });

  it("rejects a malformed Origin (URL parse throws)", () => {
    expect(
      checkOrigin(req({ origin: "not a url", host: "you-inc.vercel.app" })),
    ).toBe(false);
  });
});

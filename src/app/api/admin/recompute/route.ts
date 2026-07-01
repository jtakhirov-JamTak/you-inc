// Admin batch recompute — force-replays EVERY user's projection under the current
// SCORING_VERSION. Use after a constant tune + version bump to push the recompute to
// all users at once, instead of waiting for each user to trigger the lazy replay on
// their next load (which fully covers the single-user concierge on its own).
//
// settleUser is idempotent and already REPLAYS on a version gap (recompute + replace
// from frozen facts — never a reset to baseline), so this is safe to run any time and
// to re-run freely: users with nothing to do short-circuit cheaply.
//
// SECURITY MODEL — deliberately unlike a normal user endpoint:
//   • No session auth. This is a server-to-server / manual job (curl, cron), so there
//     is no logged-in browser session. It is authenticated by a shared secret in the
//     `Authorization: Bearer <ADMIN_TASK_SECRET>` header, compared in constant time.
//   • No CSRF/origin/paywall gate — there is no browser session or purchase to guard.
//   • DISABLED unless ADMIN_TASK_SECRET is set: a missing secret returns 404, so the
//     route can never be "open" by omission.
//   • MUST stay in middleware.ts's public allowlist — otherwise the unauthenticated
//     (no cookie) caller is 307-redirected to /login and never reaches this handler.
// Runs under the service role (bypasses RLS) to enumerate all users + settle each.
import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import * as Sentry from "@sentry/nextjs";
import { createServiceClient } from "@/lib/supabase/service";
import { settleUser } from "@/lib/price/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Constant-time secret comparison. Length is compared first (timingSafeEqual throws
// on unequal-length buffers) — that a mismatch is length-dependent is acceptable; the
// secret's bytes never short-circuit the compare.
function secretMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const expected = process.env.ADMIN_TASK_SECRET;
  // No secret configured → the feature is OFF. Never treat "unset" as "open".
  if (!expected) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const header = req.headers.get("authorization");
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!presented || !secretMatches(presented, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data: users, error } = await supabase.from("user_profiles").select("id");
  if (error) {
    console.error("admin recompute: user list failed", error.code);
    return NextResponse.json({ error: "Could not list users" }, { status: 500 });
  }

  let recomputed = 0;
  const failed: string[] = [];
  // Sequential (not Promise.all): each settleUser can run its own atomic replay RPC;
  // serializing keeps DB load flat and makes a partial failure easy to report. At any
  // realistic user count this is fine; revisit with batching if it ever isn't.
  for (const u of users ?? []) {
    try {
      await settleUser(u.id);
      recomputed++;
    } catch (err) {
      failed.push(u.id);
      Sentry.captureException(err, {
        tags: { area: "price", kind: "admin_recompute_failed" },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    usersTotal: (users ?? []).length,
    recomputed,
    failed: failed.length,
  });
}

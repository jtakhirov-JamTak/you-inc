import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { rateLimit } from "@/lib/rate-limit";
import { safeNextPath } from "@/lib/safe-next";

// Cooldown-latched capture: if session exchange starts failing (Supabase auth
// outage, key rotation, SSR cookie regression) EVERY login hits this branch and
// silently bounces to /login. Without a signal here that looks identical to a
// normal "no code" visit and ops gets nothing. Module-scoped per rate-limit.ts.
const EXCHANGE_FAIL_COOLDOWN_MS = 5 * 60 * 1000;
let lastExchangeFailCaptureAt = 0;

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/home";

  // Rate limit by IP to prevent auth code brute-force
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await rateLimit(`auth-callback:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.redirect(`${origin}/login`);
  }

  // Validate redirect target against open-redirect vectors (protocol-relative
  // "//host", backslash-folded "/\host", control chars). See safeNextPath.
  const safeNext = safeNextPath(next);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
    // A code was present but exchange failed — this is a real auth failure, not
    // a normal no-code visit. Surface it (latched) so a login-wide outage pages
    // us instead of silently bouncing every user to /login.
    const now = Date.now();
    if (now - lastExchangeFailCaptureAt >= EXCHANGE_FAIL_COOLDOWN_MS) {
      lastExchangeFailCaptureAt = now;
      Sentry.captureException(new Error("auth_code_exchange_failed"), {
        tags: { area: "auth", kind: "code_exchange_failed" },
      });
    }
  }

  // Auth error — redirect to login
  return NextResponse.redirect(`${origin}/login`);
}

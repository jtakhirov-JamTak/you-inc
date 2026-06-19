"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Wordmark } from "@/components/brand/Wordmark";
import { StormBackground } from "@/components/brand/StormBackground";
import { GoogleGlyph } from "@/components/brand/GoogleGlyph";
import { cn } from "@/lib/utils";
import { inputClass } from "@/components/ui/field";
import { pillAccentClass } from "@/components/ui/button";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const oauthInFlight = useRef(false);

  // iOS PWA standalone mode opens OAuth in Safari, not the PWA itself —
  // session cookie lands in the wrong storage and the app never sees it.
  // Detected client-side after mount; flash from "Continue with Google" to
  // the warning is acceptable for this edge case.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      ("standalone" in window.navigator &&
        (window.navigator as Navigator & { standalone?: boolean })
          .standalone === true);
    // One-shot client-only PWA detection: reads window after mount, so the
    // effect-then-setState is intentional (a lazy useState initializer would
    // run during SSR with no window and cause a hydration mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsStandalone(Boolean(standalone));
  }, []);

  async function handleGoogle() {
    if (oauthInFlight.current) return;
    oauthInFlight.current = true;
    setError(null);
    setLoading(true);

    // 10s safety net: if signInWithOAuth resolves cleanly but the browser
    // never navigates (popup blocker, extension, OS intervention), the CTA
    // would stay disabled forever. Re-arm with a recoverable error.
    const stuckTimer = window.setTimeout(() => {
      if (oauthInFlight.current) {
        oauthInFlight.current = false;
        setLoading(false);
        setError(
          "Google sign-in didn't open. Tap again, or use email below.",
        );
      }
    }, 10_000);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?next=/home`,
      },
    });
    if (error) {
      window.clearTimeout(stuckTimer);
      setError(error.message);
      setLoading(false);
      oauthInFlight.current = false;
    }
    // Success: Supabase redirects the browser to Google's consent screen.
    // The stuckTimer is intentionally NOT cleared on success — the browser
    // is about to leave this page, so the timer never gets a chance to fire.
    // If the redirect doesn't happen within 10s, the timer recovers the UI.
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Full navigation (not client-side) so the middleware runs and sets
    // session cookies before the home page tries to read auth state.
    // router.push + router.refresh is a race — the page can mount before
    // the middleware processes the new session.
    window.location.href = "/home";
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-6 pb-[env(safe-area-inset-bottom)] pt-[max(3rem,env(safe-area-inset-top))]">
      <StormBackground />

      <div className="w-full max-w-sm">
        <div className="flex justify-center">
          <Wordmark size={18} />
        </div>
        <h1
          className="mt-8 font-display text-[30px] font-medium leading-[1.12] text-ink text-center"
          style={{ letterSpacing: "-0.7px" }}
        >
          Log in
        </h1>
        <p className="mt-2 text-center text-[14px] font-medium leading-[1.5] text-ink-soft">
          Welcome back.
        </p>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={loading || isStandalone}
          aria-label="Continue with Google"
          className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-pill border border-hairline bg-surface text-[15px] font-bold text-ink transition active:scale-[0.98] disabled:opacity-50"
        >
          <GoogleGlyph />
          Continue with Google
        </button>

        {isStandalone && (
          <p className="mt-2 text-center text-[12px] font-medium leading-[1.4] text-ink-soft">
            Google sign-in works in Safari, not the Home Screen app. Use email
            below, or open You, Inc. from Safari to use Google.
          </p>
        )}

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-hair" />
          <span className="text-[12px] font-semibold text-ink-soft">
            or continue with email
          </span>
          <div className="h-px flex-1 bg-hair" />
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-[13px] font-semibold text-ink"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={cn(inputClass, "mt-1.5")}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-[13px] font-semibold text-ink"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className={cn(inputClass, "mt-1.5")}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-[13px] font-medium text-danger">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className={cn(pillAccentClass, "h-14 w-full text-[15px]")}
          >
            {loading ? "Logging in..." : "Log in"}
          </button>
        </form>

        <p className="mt-6 text-center text-[13px] font-medium text-ink-soft">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="inline-flex min-h-11 items-center px-2 text-[13px] font-semibold text-accent-ink underline active:opacity-70"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Wordmark } from "@/components/brand/Wordmark";
import { PageBackground } from "@/components/brand/PageBackground";
import { GoogleGlyph } from "@/components/brand/GoogleGlyph";
import { cn } from "@/lib/utils";
import { inputClass } from "@/components/ui/field";
import { pillAccentClass } from "@/components/ui/button";

export default function SignupPage() {
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
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
    setAlreadyRegistered(false);
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
    // The stuckTimer intentionally not cleared on success — the browser is
    // about to leave this page so the timer never fires. If the redirect
    // doesn't happen within 10s, the timer recovers the UI.
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAlreadyRegistered(false);
    setLoading(true);

    const trimmedName = firstName.trim().slice(0, 50);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback`,
        data: trimmedName ? { first_name: trimmedName } : undefined,
      },
    });

    if (error) {
      // Supabase returns "User already registered" (or a near variant) when
      // the email exists. Match both the HTTP status code (primary, stable)
      // and the English message (fallback) so localization or minor wording
      // changes don't silently break the graceful path.
      const looksAlreadyRegistered =
        error.status === 422 ||
        /already\s+(registered|exists|in use)/i.test(error.message) ||
        /user\s+exists/i.test(error.message);
      if (looksAlreadyRegistered) {
        setAlreadyRegistered(true);
      } else {
        setError(error.message);
      }
      setLoading(false);
      return;
    }

    // Full navigation so middleware sets session cookies before the home page
    // tries to read auth state. Client-side push + refresh is a race.
    window.location.href = "/home";
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-6 pb-[env(safe-area-inset-bottom)] pt-[max(3rem,env(safe-area-inset-top))]">
      <PageBackground />

      <div className="w-full max-w-sm">
        <div className="flex justify-center">
          <Wordmark size={18} />
        </div>
        <h1
          className="mt-8 font-display text-[30px] font-medium leading-[1.12] text-ink text-center"
          style={{ letterSpacing: "-0.7px" }}
        >
          Create account
        </h1>
        <p className="mt-2 text-center text-[14px] font-medium leading-[1.5] text-ink-soft">
          Start running yourself like a company.
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

        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label
              htmlFor="firstName"
              className="block text-[13px] font-semibold text-ink"
            >
              First name
            </label>
            <input
              id="firstName"
              type="text"
              inputMode="text"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              maxLength={50}
              required
              className={cn(inputClass, "mt-1.5")}
              placeholder="Jane"
            />
          </div>

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
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className={cn(inputClass, "mt-1.5")}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p role="alert" className="text-[13px] font-medium text-danger">{error}</p>
          )}

          {alreadyRegistered && (
            <div className="space-y-3 rounded-card border border-hairline bg-warm-soft p-4">
              <p className="text-[13px] font-medium leading-[1.5] text-ink">
                You already have an account with this email. Log in to pick up
                where you left off.
              </p>
              <Link
                href="/login"
                className={cn(pillAccentClass, "h-12 w-full text-[14px]")}
              >
                Log in instead
              </Link>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className={cn(pillAccentClass, "h-14 w-full text-[15px]")}
          >
            {loading ? "Creating account..." : "Get started"}
          </button>

          <p className="text-center text-[12px] font-medium leading-[1.5] text-ink-soft">
            By creating an account you agree to our{" "}
            <Link href="/terms" className="text-accent-ink underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-accent-ink underline">
              Privacy Policy
            </Link>
            .
          </p>
        </form>

        <p className="mt-6 text-center text-[13px] font-medium text-ink-soft">
          Already have an account?{" "}
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center px-2 text-[13px] font-semibold text-accent-ink underline active:opacity-70"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}

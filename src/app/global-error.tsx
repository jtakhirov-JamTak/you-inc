"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Something went wrong</title>
      </head>
      {/* global-error bypasses the root layout, so the Storm body styles in
          globals.css don't apply here. Set the dark background + ink inline so
          the error screen never flashes white even if the stylesheet is late. */}
      <body style={{ background: "#0f1825", color: "#eaf1f8" }}>
        <div className="flex min-h-dvh flex-col items-center justify-center px-5">
          <p className="text-6xl font-medium" style={{ color: "#9db0c6" }}>
            !
          </p>
          <p className="mt-4 text-base font-semibold" style={{ color: "#eaf1f8" }}>
            Something went wrong
          </p>
          <p className="mt-1 text-sm font-medium" style={{ color: "#9db0c6" }}>
            We&apos;ve been notified. Try again in a moment.
          </p>
          <button
            onClick={reset}
            className="mt-6 flex h-12 items-center rounded-full px-6 text-sm font-bold active:scale-[0.98]"
            style={{ background: "#56a8f2", color: "#0b1521" }}
          >
            Try again
          </button>
          {/* global-error renders its own <html> outside the app tree, so a
              hard navigation via <a> is intentional here, not <Link>. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="mt-3 flex h-11 items-center px-4 text-sm font-medium"
            style={{ color: "#9db0c6" }}
          >
            Back home
          </a>
        </div>
      </body>
    </html>
  );
}

"use client";

import { useEffect } from "react";

// Keeps user_settings.timezone in step with the browser's real IANA zone. Mounted
// once in the authenticated app layout, it fires a single fire-and-forget POST per
// browser session; the endpoint only writes when the zone actually differs, so a
// returning user with the correct zone costs one cheap no-op request (or none, if
// already synced this session). This is what stops the engine from bucketing a
// user's "day" in UTC — without it, the day rolls over early for anyone west of UTC.
//
// Renders nothing. Errors are swallowed: a failed sync just leaves the prior zone
// in place and retries next session — it must never disrupt the UI.
const SESSION_KEY = "tz-synced";

export function TimezoneSync() {
  useEffect(() => {
    // Send at most once per browser session — navigation within the app doesn't
    // remount the layout, but a hard reload would, so the guard also covers that.
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
    } catch {
      // sessionStorage can throw (private mode / disabled) — proceed without the
      // guard; the endpoint's no-op-on-unchanged keeps repeats harmless.
    }

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return;

    void fetch("/api/settings/timezone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: tz }),
    })
      .then((res) => {
        if (res.ok) {
          try {
            sessionStorage.setItem(SESSION_KEY, "1");
          } catch {
            // ignore — worst case we re-send next mount (a no-op server-side).
          }
        }
      })
      .catch(() => {
        // Network hiccup — leave the stored zone as-is; retry next session.
      });
  }, []);

  return null;
}

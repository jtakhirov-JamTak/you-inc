import * as Sentry from "@sentry/nextjs";

// Cooldown-latched capture for server-component parallel reads. Without this,
// a request during a DB outage swallows `.error` silently and the user sees
// an empty state with zero operator signal (CLAUDE.md: "maybeSingle(), bare
// .select(), upsert, update do NOT throw on DB errors"). Per-kind Map so a
// single failing query doesn't mask captures from other kinds.
const COOLDOWN_MS = 5 * 60 * 1000;
const lastCaptures = new Map<string, number>();

export function captureServerRead(
  area: string,
  kind: string,
  err: unknown,
): void {
  const key = `${area}:${kind}`;
  const now = Date.now();
  const last = lastCaptures.get(key) ?? 0;
  if (now - last < COOLDOWN_MS) return;
  lastCaptures.set(key, now);
  Sentry.captureException(err, { tags: { area, kind } });
}

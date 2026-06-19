// Structured success/operational events — the positive counterpart to the
// Sentry.captureException failure signal scattered across the app. Every error
// path here is already observable; the HAPPY path was silent, so there was no
// way to (a) see AI spend, or (b) know the AI pipeline was even alive.
//
// recordEvent emits an info-level Sentry event. beforeSend (scrubEvent) runs on
// these too, so they get the same privacy treatment as exceptions — but the
// CONTRACT is that callers pass ONLY non-PII scalars (module name, tier, coin
// count, attempt count, latency, booleans). NEVER user content (emotions,
// journal text, person names, quotes). There is no per-field scrubber on the
// `data` extras here; the contract is the guard.
//
// Consumer: Sentry search/dashboards + founder-created alert rules. The two it
// was built for:
//   - cost-runaway: events tagged `area=ai_spend`; alert when count-per-hour (or
//     summed `coins`) spikes past a normal-usage threshold.
//   - success heartbeat: the SAME stream's ABSENCE means the AI path stopped
//     succeeding — alert when `area=ai_spend` rate drops to zero.
//
// Quota note: one event per successful generation. Fine at launch scale (AI
// generations are human-paced and coin-gated). If volume grows, sample here or
// move to a metrics backend — and do NOT copy this onto a hotter path (per-
// request, per-row) without revisiting, per the per-success-event quota trap.

import * as Sentry from "@sentry/nextjs";

type EventTags = Record<string, string>;
type EventData = Record<string, number | string | boolean>;

/**
 * Record a structured success/operational event. `name` is the event title
 * (e.g. "ai.generated"); `tags` are low-cardinality dimensions you can filter
 * and alert on in Sentry (always include an `area`); `data` is optional scalar
 * detail. Pass NO user content — see the file header contract.
 */
export function recordEvent(
  name: string,
  tags: EventTags,
  data?: EventData,
): void {
  Sentry.captureMessage(name, {
    level: "info",
    tags,
    extra: data,
  });
}

import * as Sentry from "@sentry/nextjs";
import { scrubEvent, scrubBreadcrumb } from "./sentry-scrub";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? "development",
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

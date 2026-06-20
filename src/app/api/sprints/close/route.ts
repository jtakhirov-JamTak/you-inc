// Close the active sprint → book its realized return to the price_ledger. Handler
// order: origin → auth → rate-limit → validate → act. The booking + queue promotion
// run under the service role (closeSprint); idempotency is the ledger's
// sprint_realized key + the active-status guard (a second close → 409).
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getAuthUser } from "@/lib/supabase/server";
import { closeSprintSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { checkOrigin } from "@/lib/check-origin";
import { closeSprint } from "@/lib/price/sprint-runner";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const {
    data: { user },
    error: authError,
  } = await getAuthUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await rateLimit(`sprints:close:${user.id}`, {
    limit: 20,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = closeSprintSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { sprintId, goalAchieved } = parsed.data;

  try {
    // closeSprint runs under the service role (bypasses RLS): pass the
    // AUTHENTICATED user's id only.
    const result = await closeSprint(user.id, sprintId, goalAchieved);
    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (err) {
    const message = (err as Error).message;
    // A re-close (sprint no longer active) is a client-recoverable 409, not a 500.
    if (message === "sprint_not_active") {
      return NextResponse.json({ error: "Sprint is not active" }, { status: 409 });
    }
    if (message === "sprint_read_failed") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("sprint close failed", message);
    Sentry.captureException(err, {
      tags: { area: "sprints", kind: "close_failed" },
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

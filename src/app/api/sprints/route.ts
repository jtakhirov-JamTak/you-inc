// Create a sprint — a time-boxed investment toward a year goal (spec §Sprints).
// One active at a time + a sequential queue; the set-time balance and locked dollar
// grid freeze server-side at create. Handler order: origin → auth → rate-limit →
// validate → act (createSprint freezes the basis + enforces the queue).
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getAuthUser } from "@/lib/supabase/server";
import { createSprintSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { checkOrigin } from "@/lib/check-origin";
import { createSprint } from "@/lib/price/sprint-runner";

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

  const rl = await rateLimit(`sprints:create:${user.id}`, {
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
  const parsed = createSprintSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    // createSprint runs under the service role (bypasses RLS): pass the
    // AUTHENTICATED user's id only, never a client-supplied id.
    const result = await createSprint(user.id, parsed.data);
    return NextResponse.json({ ok: true, sprint: result }, { status: 201 });
  } catch (err) {
    console.error("sprint create failed", (err as Error).message);
    Sentry.captureException(err, {
      tags: { area: "sprints", kind: "create_failed" },
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// Toggle one sprint task's done state. Uses the RLS client (policies scope every
// row to auth.uid()), so ownership is enforced by the database. Only tasks of the
// ACTIVE sprint are editable: a closed sprint's outcome is already booked from the
// completion snapshot at close, so editing its checklist would diverge raw from the
// booked ledger (mirrors the settled-week habit-log lock).
import { NextResponse } from "next/server";
import { getAuthUser, createClient } from "@/lib/supabase/server";
import { sprintTaskToggleSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { checkOrigin } from "@/lib/check-origin";

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

  const rl = await rateLimit(`sprints:task:${user.id}`, {
    limit: 120,
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
  const parsed = sprintTaskToggleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { taskId, done } = parsed.data;

  const supabase = await createClient();

  // RLS scopes this to the owner; the join pulls the parent sprint's status so we
  // can reject edits to anything but the active sprint in one round-trip.
  const { data: task, error: taskErr } = await supabase
    .from("sprint_tasks")
    .select("id, sprints!inner(status)")
    .eq("id", taskId)
    .maybeSingle();
  if (taskErr) {
    console.error("sprint task: read failed", taskErr.code);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
  if (!task) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const sprintStatus = (task.sprints as unknown as { status: string }).status;
  if (sprintStatus !== "active") {
    return NextResponse.json({ error: "Sprint is not active" }, { status: 409 });
  }

  const { error: updErr } = await supabase
    .from("sprint_tasks")
    .update({ done, done_at: done ? new Date().toISOString() : null })
    .eq("id", taskId);
  if (updErr) {
    console.error("sprint task: update failed", updErr.code);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

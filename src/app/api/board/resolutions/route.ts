// Board resolutions — the checkable commitments carried into the following week.
// POST adds one, PATCH toggles its checked state, DELETE removes it. All run on the
// RLS client (board_resolutions owner full CRUD; migration 0009), with an explicit
// user_id filter as defense-in-depth. Resolutions are user checklist data — they
// don't feed the price engine, so full edit/delete is intended (no append-only rule).
import { NextResponse } from "next/server";
import { getAuthUser, createClient } from "@/lib/supabase/server";
import {
  boardResolutionAddSchema,
  boardResolutionToggleSchema,
  boardResolutionDeleteSchema,
} from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { checkOrigin } from "@/lib/check-origin";

export const runtime = "nodejs";

// Add a resolution. for_week_index is derived from the meeting's week_index
// server-side (never trusted from the client), and user_id comes from auth.
export async function POST(req: Request) {
  const guard = await authAndLimit(req, "add");
  if ("response" in guard) return guard.response;
  const { user, supabase } = guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = boardResolutionAddSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { meetingId, text } = parsed.data;

  // Read the parent meeting (RLS scopes to owner) to derive for_week_index and to
  // confirm ownership before inserting.
  const { data: meeting, error: readErr } = await supabase
    .from("board_meetings")
    .select("week_index")
    .eq("id", meetingId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readErr) {
    console.error("board resolution: meeting read failed", readErr.code);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
  if (!meeting) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error: insErr } = await supabase.from("board_resolutions").insert({
    user_id: user.id,
    meeting_id: meetingId,
    for_week_index: meeting.week_index + 1,
    text,
  });
  if (insErr) {
    console.error("board resolution: insert failed", insErr.code);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

// Toggle a resolution's checked state.
export async function PATCH(req: Request) {
  const guard = await authAndLimit(req, "toggle");
  if ("response" in guard) return guard.response;
  const { user, supabase } = guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = boardResolutionToggleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { resolutionId, checked } = parsed.data;

  const { error: updErr } = await supabase
    .from("board_resolutions")
    .update({ checked })
    .eq("id", resolutionId)
    .eq("user_id", user.id);
  if (updErr) {
    console.error("board resolution: toggle failed", updErr.code);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

// Remove a resolution.
export async function DELETE(req: Request) {
  const guard = await authAndLimit(req, "delete");
  if ("response" in guard) return guard.response;
  const { user, supabase } = guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = boardResolutionDeleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { resolutionId } = parsed.data;

  const { error: delErr } = await supabase
    .from("board_resolutions")
    .delete()
    .eq("id", resolutionId)
    .eq("user_id", user.id);
  if (delErr) {
    console.error("board resolution: delete failed", delErr.code);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

// Shared origin → auth → rate-limit gate. Returns either a short-circuit response
// or the authed user + RLS client. `op` only varies the rate-limit bucket.
async function authAndLimit(
  req: Request,
  op: "add" | "toggle" | "delete",
): Promise<
  | { response: NextResponse }
  | {
      user: { id: string };
      supabase: Awaited<ReturnType<typeof createClient>>;
    }
> {
  if (!checkOrigin(req)) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const {
    data: { user },
    error: authError,
  } = await getAuthUser();
  if (authError || !user) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const rl = await rateLimit(`board:resolution:${op}:${user.id}`, {
    limit: 120,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return {
      response: NextResponse.json({ error: "Too many requests" }, { status: 429 }),
    };
  }

  const supabase = await createClient();
  return { user, supabase };
}

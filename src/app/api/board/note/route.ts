// Edit the "Note to the chair" on a board meeting. Handler order:
// origin → auth → rate-limit → validate → act. Uses the RLS client (board_meetings
// owner UPDATE policy scopes the row to auth.uid()); the explicit user_id filter is
// defense-in-depth. The note is narrative — it doesn't feed the price engine, so an
// edit on any (incl. settled) meeting is allowed by design.
import { NextResponse } from "next/server";
import { getAuthUser, createClient } from "@/lib/supabase/server";
import { boardNoteSchema } from "@/lib/validation";
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

  const rl = await rateLimit(`board:note:${user.id}`, {
    limit: 60,
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
  const parsed = boardNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { meetingId, note } = parsed.data;

  const supabase = await createClient();
  // Empty string clears the note; store null so the read path falls back to the
  // placeholder. Update only the `note` column — no other field is touched.
  const { error: updErr } = await supabase
    .from("board_meetings")
    .update({ note: note.trim() === "" ? null : note })
    .eq("id", meetingId)
    .eq("user_id", user.id);
  if (updErr) {
    console.error("board note: update failed", updErr.code);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

// Update the user's settlement timezone. Handler order:
// origin → auth → rate-limit → validate → act. Uses the RLS client (the
// user_settings owner UPDATE policy scopes the row to auth.uid()); the explicit
// user_id filter is defense-in-depth.
//
// WHY THIS EXISTS: user_settings.timezone defaults to 'UTC' at signup and was
// never captured from the client, so the price engine bucketed every user's
// "day"/"week" in UTC — rolling the day over early for anyone west of UTC. The
// client's TimezoneSync posts the browser's real IANA zone here on app load.
//
// The write is gated on an actual change (`.neq`) so the common case (zone already
// correct) is a no-op — no needless write on every page load. The body timezone is
// the source of truth; we never trust a stored value over the live browser zone.
import { NextResponse } from "next/server";
import { getAuthUser, createClient } from "@/lib/supabase/server";
import { updateTimezoneSchema } from "@/lib/validation";
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

  const rl = await rateLimit(`settings:tz:${user.id}`, {
    limit: 30,
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
  const parsed = updateTimezoneSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { timezone } = parsed.data;

  const supabase = await createClient();
  // Write only when the zone actually changes. `.neq` makes "already correct" a
  // no-op (0 rows) — the request still succeeds.
  const { error: updErr } = await supabase
    .from("user_settings")
    .update({ timezone, updated_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .neq("timezone", timezone);
  if (updErr) {
    console.error("settings timezone: update failed", updErr.code);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

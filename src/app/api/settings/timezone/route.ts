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
//
// FROZEN ANCHORS (migration 0036): the engine no longer reads the live `timezone`
// column — it reads `settlement_timezone` / `signup_local_date`, which are seeded
// 'UTC' at signup and LOCK at the user's first frozen fact. Until that lock, this
// endpoint keeps the anchors in step with the live zone (founder ruling: locking
// at signup would freeze UTC before the browser ever reports the real zone). After
// the lock, only the live display column moves; the anchor update is skipped here
// and the 0036 trigger rejects it as the race backstop.
import { NextResponse } from "next/server";
import { getAuthUser, createClient } from "@/lib/supabase/server";
import { updateTimezoneSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { checkOrigin } from "@/lib/check-origin";
import { localDateInTz } from "@/lib/price/dates";

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

  // ── Anchor sync (pre-lock only). While the user has NO frozen fact, the
  // settlement anchors track the live zone so the first-ever settlement runs on
  // the user's real clock, not the signup 'UTC' seed. signup_local_date is
  // re-derived in the new zone (it feeds "week 0" of the grid). Once a
  // settled_weeks / sprint_closes row exists we skip — and if a first settle
  // races this check, the 0036 trigger rejects the update; both are tolerated
  // (the anchors are simply locked, which is the correct end state).
  const [swRes, scRes] = await Promise.all([
    supabase
      .from("settled_weeks")
      .select("week_index")
      .eq("user_id", user.id)
      .limit(1),
    supabase
      .from("sprint_closes")
      .select("sprint_id")
      .eq("user_id", user.id)
      .limit(1),
  ]);
  const frozenKnown = !swRes.error && !scRes.error;
  const hasFrozenFact =
    (swRes.data?.length ?? 0) > 0 || (scRes.data?.length ?? 0) > 0;
  if (frozenKnown && !hasFrozenFact) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("created_at")
      .eq("id", user.id)
      .maybeSingle();
    if (profile) {
      const signupLocal = localDateInTz(new Date(profile.created_at), timezone);
      const { error: anchorErr } = await supabase
        .from("user_settings")
        .update({
          settlement_timezone: timezone,
          signup_local_date: signupLocal,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id)
        .neq("settlement_timezone", timezone);
      if (
        anchorErr &&
        !anchorErr.message?.includes("settlement_anchors_locked")
      ) {
        // Non-fatal: the live zone is saved; the anchors stay on their previous
        // value and the next sync retries. Never fail the request over this.
        console.error("settings timezone: anchor sync failed", anchorErr.code);
      }
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

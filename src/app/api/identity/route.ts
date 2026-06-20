// Identity charter save (spec §Identity). Replaces the user's whole charter:
// the 3 values, the 3 fixed modes, and the affirmations list. All content is
// user-authored — these are editable rows (not append-only logs), so values and
// modes upsert by their natural key and affirmations are replaced wholesale.
//
// Handler order: origin → auth → rate-limit → validate → write.
//
// Owner is the session user (never the body); RLS re-checks every write. Not
// atomic across the three tables (no single transaction via the JS client); a
// partial failure is recoverable by re-saving. Good enough for a solo user — an
// RPC can make it transactional later if needed.
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getAuthUser, createClient } from "@/lib/supabase/server";
import { saveIdentitySchema } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { checkOrigin } from "@/lib/check-origin";

export const runtime = "nodejs";

function fail(area: string) {
  console.error("identity save failed", area);
  Sentry.captureException(new Error("identity_save_failed"), {
    tags: { area: "identity", kind: area },
  });
  return NextResponse.json({ error: "Server error" }, { status: 500 });
}

export async function PUT(req: Request) {
  // 1. Origin.
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 2. Auth.
  const {
    data: { user },
    error: authError,
  } = await getAuthUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 3. Rate limit.
  const rl = await rateLimit(`identity:save:${user.id}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  // 4. Validate.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = saveIdentitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { values, modes, affirmations } = parsed.data;

  const supabase = await createClient();
  const now = new Date().toISOString();

  // 5a. Values — upsert by (user_id, position).
  const { error: valuesError } = await supabase.from("identity_values").upsert(
    values.map((v) => ({
      user_id: user.id,
      position: v.position,
      title: v.title,
      meaning: v.meaning,
      updated_at: now,
    })),
    { onConflict: "user_id,position" },
  );
  if (valuesError) return fail("values");

  // 5b. Modes — upsert by (user_id, mode_key).
  const { error: modesError } = await supabase.from("identity_modes").upsert(
    modes.map((m) => ({
      user_id: user.id,
      mode_key: m.mode_key,
      mode_name: m.mode_name,
      description: m.description,
      updated_at: now,
    })),
    { onConflict: "user_id,mode_key" },
  );
  if (modesError) return fail("modes");

  // 5c. Affirmations — variable count. Upsert the new set by (user_id, position)
  //     FIRST, then prune any stale rows beyond the new count. Order matters: the
  //     new rows are written before anything is deleted, so there is never a
  //     window where the user's affirmations are all gone (the old delete-then-
  //     insert could wipe them and then fail to re-insert).
  if (affirmations.length > 0) {
    const { error: upError } = await supabase.from("identity_affirmations").upsert(
      affirmations.map((a, i) => ({
        user_id: user.id,
        position: i + 1,
        affirmation: a.affirmation,
        visualization: a.visualization,
        updated_at: now,
      })),
      { onConflict: "user_id,position" },
    );
    if (upError) return fail("affirmations_upsert");
  }
  // Remove rows beyond the new count (handles shrinking the list, incl. to 0).
  const { error: pruneError } = await supabase
    .from("identity_affirmations")
    .delete()
    .eq("user_id", user.id)
    .gt("position", affirmations.length);
  if (pruneError) return fail("affirmations_prune");

  return NextResponse.json({ ok: true });
}

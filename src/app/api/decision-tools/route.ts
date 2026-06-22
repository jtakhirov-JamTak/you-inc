// Decision Making save (the Regulation tools on Systems). Upserts the user's
// single decision_tools row: a meditation routine, a decision-making protocol,
// and the four Eisenhower quadrants. Editable narrative content (not a log).
//
// Handler order: origin → auth → rate-limit → validate → write.
//
// Owner is the session user (never the body); RLS re-checks every write.
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getAuthUser, createClient } from "@/lib/supabase/server";
import { saveDecisionToolsSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { checkOrigin } from "@/lib/check-origin";

export const runtime = "nodejs";

function fail(area: string) {
  console.error("decision tools save failed", area);
  Sentry.captureException(new Error("decision_tools_save_failed"), {
    tags: { area: "decision_tools", kind: area },
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
  const rl = await rateLimit(`decision-tools:save:${user.id}`, {
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
  const parsed = saveDecisionToolsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const d = parsed.data;
  const clean = (v?: string) => v?.trim() || null;

  const supabase = await createClient();
  const { error: upsertError } = await supabase.from("decision_tools").upsert(
    {
      user_id: user.id,
      meditation: clean(d.meditation),
      protocol: clean(d.protocol),
      eis_do: clean(d.eisDo),
      eis_decide: clean(d.eisDecide),
      eis_delegate: clean(d.eisDelegate),
      eis_delete: clean(d.eisDelete),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (upsertError) return fail("upsert");

  return NextResponse.json({ ok: true });
}

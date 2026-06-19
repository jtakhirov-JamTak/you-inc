// Account deletion (right-to-erasure).
//
// Irreversible HARD delete. The single call to auth.admin.deleteUser() removes
// the auth user; every user-scoped table FK-cascades from auth.users(id) ON
// DELETE CASCADE, so this one call erases all of the user's data in one
// transaction. If a future table is added WITHOUT a cascading FK to auth.users,
// it would orphan rows here; new user-scoped tables must keep that cascade
// (see CLAUDE.md / migration conventions).
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { deleteAccountSchema } from "@/lib/validation";
import { rateLimit } from "@/lib/rate-limit";
import { checkOrigin } from "@/lib/check-origin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // 1. Origin — destructive same-origin action; reject cross-site CSRF.
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 2. Validate the typed confirmation BEFORE auth work.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = deleteAccountSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Confirmation required" }, { status: 400 });
  }

  // 3. Auth — delete ONLY the caller's own account; id comes from the session,
  //    never from the client body.
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 4. Rate limit — a tiny daily cap; deletion is a once-ever action.
  const rl = await rateLimit(`account:delete:${user.id}`, {
    limit: 5,
    windowMs: 86_400_000,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  // 5. Hard delete via service role (auth.admin requires the secret key).
  const service = createServiceClient();
  const { error: delError } = await service.auth.admin.deleteUser(user.id);
  if (delError) {
    // Do NOT log the message (may echo user identifiers); tag only.
    console.error("account delete failed", delError.status);
    Sentry.captureException(new Error("account_delete_failed"), {
      tags: { area: "account", kind: "delete_failed" },
    });
    return NextResponse.json({ error: "Could not delete account" }, { status: 500 });
  }

  // The session is now invalid server-side; the client signs out + redirects.
  return NextResponse.json({ ok: true });
}

// Data export (right-to-access / portability). Returns the authenticated user's
// own rows across every user-scoped table as one downloadable JSON document.
//
// Handler order: origin → auth → rate-limit → read. RLS scopes each read to the
// owner; the explicit owner-column filter is belt-and-suspenders. Read-only, no
// service role. Fails (not partial) on any read error so an export is never a
// misleading subset of the user's data.
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getAuthUser, createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import { checkOrigin } from "@/lib/check-origin";

export const runtime = "nodejs";

// Every user-scoped table holding the user's own data, with its owner column.
// user_profiles keys on `id` (= auth.users id); all others on `user_id`.
// position_daily_snapshots is intentionally omitted — a recomputable display
// cache derived from habit_logs, not authored data with independent meaning.
const EXPORT_TABLES: { table: string; owner: string }[] = [
  { table: "user_profiles", owner: "id" },
  { table: "user_settings", owner: "user_id" },
  { table: "identity_profile", owner: "user_id" },
  { table: "identity_values", owner: "user_id" },
  { table: "identity_modes", owner: "user_id" },
  { table: "identity_affirmations", owner: "user_id" },
  { table: "habits", owner: "user_id" },
  { table: "habit_logs", owner: "user_id" },
  { table: "graduated_habits", owner: "user_id" },
  { table: "sprints", owner: "user_id" },
  { table: "sprint_tasks", owner: "user_id" },
  { table: "board_meetings", owner: "user_id" },
  { table: "board_resolutions", owner: "user_id" },
  { table: "decision_tools", owner: "user_id" },
  { table: "price_ledger", owner: "user_id" },
];

// Loose view of the RLS client for the generic table loop — the typed client's
// `.from()` generics don't compose with a dynamic table name, and this read is
// uniform (select all, filter by owner column).
type LooseRead = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (col: string, v: string) => Promise<{ data: unknown[] | null; error: { code?: string } | null }>;
    };
  };
};

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

  // Heavy read across every table — a few per hour is ample.
  const rl = await rateLimit(`account:export:${user.id}`, { limit: 5, windowMs: 3_600_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const supabase = (await createClient()) as unknown as LooseRead;
  const data: Record<string, unknown[]> = {};
  for (const { table, owner } of EXPORT_TABLES) {
    const { data: rows, error } = await supabase.from(table).select("*").eq(owner, user.id);
    if (error) {
      console.error("account export read failed", table, error.code);
      Sentry.captureException(new Error("account_export_failed"), {
        tags: { area: "account", kind: "export_failed", table },
      });
      return NextResponse.json({ error: "Could not build export" }, { status: 500 });
    }
    data[table] = rows ?? [];
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    userId: user.id,
    email: user.email ?? null,
    note:
      "One key per table; rows exactly as stored. position_daily_snapshots (a recomputable display cache) is omitted.",
    data,
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="you-inc-export.json"',
      "Cache-Control": "no-store",
    },
  });
}

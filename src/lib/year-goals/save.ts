import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Single-active-goal upsert, shared by the quick-edit PUT and the guided flow so
// the "keep exactly one active goal" invariant lives in one place. Archives any
// OTHER active rows first (so switching the goal's area can't collide with the
// legacy one-active-per-area unique index, 0005), then updates the existing
// active row or inserts a new one. `updated_at` is stamped here.
//
// Takes a supabase client + the auth'd userId (never a body-supplied id). Returns
// the goal id on success, or a failure with a stage label + DB code the caller
// maps to its own error response.

type Client = SupabaseClient<Database>;

// The writable goal columns (area + title required; everything else optional).
// user_id / status / id / timestamps are owned by this helper, not the caller.
export type GoalFields = Omit<
  Database["public"]["Tables"]["year_goals"]["Insert"],
  "user_id" | "status" | "id" | "created_at" | "updated_at"
>;

export type GoalUpsertResult =
  | { ok: true; goalId: string }
  | { ok: false; stage: "read" | "archive" | "update" | "insert"; code?: string };

export async function upsertActiveYearGoal(
  supabase: Client,
  userId: string,
  fields: GoalFields,
): Promise<GoalUpsertResult> {
  const now = new Date().toISOString();

  // Existing active goal (single-goal model). Tolerate the absent case; only a
  // real read error is fatal (a failed read must not look like "no goal").
  const { data: existing, error: readError } = await supabase
    .from("year_goals")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readError) return { ok: false, stage: "read", code: readError.code };

  // Archive any OTHER active rows first.
  let archiveQuery = supabase
    .from("year_goals")
    .update({ status: "archived", updated_at: now })
    .eq("user_id", userId)
    .eq("status", "active");
  if (existing) archiveQuery = archiveQuery.neq("id", existing.id);
  const { error: archiveError } = await archiveQuery;
  if (archiveError) return { ok: false, stage: "archive", code: archiveError.code };

  if (existing) {
    const { error: updateError } = await supabase
      .from("year_goals")
      .update({ ...fields, updated_at: now })
      .eq("id", existing.id)
      .eq("user_id", userId);
    if (updateError) return { ok: false, stage: "update", code: updateError.code };
    return { ok: true, goalId: existing.id };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("year_goals")
    .insert({ user_id: userId, status: "active", updated_at: now, ...fields })
    .select("id")
    .single();
  if (insertError || !inserted) {
    return { ok: false, stage: "insert", code: insertError?.code };
  }
  return { ok: true, goalId: inserted.id };
}

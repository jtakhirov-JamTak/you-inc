import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Verify that a person_id belongs to the authenticated user and is active.
 * RLS scopes the query, but the explicit user_id filter is belt-and-suspenders
 * to prevent FK-based linking to another user's person via a crafted request.
 */
export async function verifyPersonOwnership(
  supabase: SupabaseClient,
  userId: string,
  personId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("persons")
    .select("person_id")
    .eq("person_id", personId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  return !!data;
}

/**
 * Verify that a thread_id belongs to the authenticated user. Same belt-and-
 * suspenders rationale as verifyPersonOwnership: a client may now hand a
 * threadId to the coach module (Convos→Review return loop), so a crafted
 * request could otherwise attach an entry to another user's conversation.
 */
export async function verifyThreadOwnership(
  supabase: SupabaseClient,
  userId: string,
  threadId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("conversation_threads")
    .select("thread_id")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

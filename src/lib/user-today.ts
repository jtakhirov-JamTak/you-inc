import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { localDateInTz, type LocalDate } from "@/lib/price/dates";

// "Today" as a local YYYY-MM-DD in the user's settlement timezone, with the same
// UTC fallback the engine uses: an unset / bogus zone must not throw (it would
// blank dates downstream). Centralizes the fallback policy that was copy-pasted
// across the habit-create, habit-review, and mission-habit routes — so "what
// local date is it for this user" is decided in exactly one place.
export async function getUserToday(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<LocalDate> {
  const { data: settings } = await supabase
    .from("user_settings")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();
  try {
    return localDateInTz(new Date(), settings?.timezone || "UTC");
  } catch {
    return localDateInTz(new Date(), "UTC");
  }
}

// Service role client — bypasses RLS for privileged writes.
// Used by admin routes, the coins ledger (grant/spend/refund via RPC), the
// Stripe webhook (purchase grants + event log), and any other path that must
// write to RLS-pinned columns. NEVER import in client components or middleware.
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error(
      "createServiceClient: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set"
    );
  }
  return createClient<Database>(url, secretKey);
}

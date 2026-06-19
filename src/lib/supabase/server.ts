import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Database } from "@/types/database";

// Wrapped in React.cache() so layout + page + helpers within a single
// server render share one Supabase client instance. The client itself
// is cheap to construct, but this also unlocks downstream per-request
// deduping (see getAuthUser below): if every caller shared a client,
// they'd each call .auth.getUser() and each would hit the network.
// Caching the auth-user lookup alongside is the real win.
export const createClient = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Ignored in Server Components where cookies can't be set
          }
        },
      },
    }
  );
});

// Per-request cached auth.getUser(). The layout, page, and any helper
// in the same server render used to each hit Supabase Auth to validate
// the JWT — three round trips for one user. Wrapping in React.cache()
// collapses that to one round trip per request. Same-shape return
// value as supabase.auth.getUser() so call sites replace
//   const supabase = await createClient();
//   const { data: { user } } = await supabase.auth.getUser();
// with
//   const { data: { user } } = await getAuthUser();
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  return supabase.auth.getUser();
});


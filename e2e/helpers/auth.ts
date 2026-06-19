import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const TEST_EMAIL_DOMAIN = "youinc-test.dev";

export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "Playwright auth helper requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local"
    );
  }
  // Guard against accidentally running against a remote Supabase project.
  // Today the project in .env.local IS the live one — there's no separate
  // test project — so every run creates real auth rows. Require an explicit
  // opt-in to prevent typos and CI misconfigs from silently touching prod.
  const isRemote = /\.supabase\.co/i.test(url);
  if (isRemote && process.env.ALLOW_E2E_AGAINST_REMOTE !== "1") {
    throw new Error(
      `E2E tests are pointed at a remote Supabase project (${url}). ` +
        `Set ALLOW_E2E_AGAINST_REMOTE=1 to acknowledge, or point ` +
        `NEXT_PUBLIC_SUPABASE_URL at a local/test project.`
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function newTestEmail(): string {
  return `test-${randomUUID()}@${TEST_EMAIL_DOMAIN}`;
}

export function newTestPassword(): string {
  return `Test-${randomUUID()}!`;
}

export async function createConfirmedUser(
  admin: SupabaseClient,
  email: string,
  password: string
): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  if (!data.user) throw new Error("createUser returned no user");
  return data.user.id;
}

export async function deleteUserById(
  admin: SupabaseClient,
  userId: string
): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(userId);
  // Cleanup is best-effort; swallow errors to avoid masking real test
  // failures. FK cascades handle downstream data; orphans in auth.users
  // are cleanable manually via the @youinc-test.dev email domain.
  if (error) {
    console.warn(`deleteUser cleanup failed for ${userId}: ${error.message}`);
  }
}

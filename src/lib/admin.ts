// Admin detection. isAdmin is the hot-path env-var gate used by the layout +
// any admin-gated route, so a regression that wrongly returns true would expose
// admin surfaces to a non-admin. Sync + DB-free on purpose.

/**
 * Fast, sync admin check via env var. Use in hot paths (layout gate,
 * API routes) where a DB call would add latency to every request.
 */
export function isAdmin(email: string | undefined): boolean {
  if (!email) return false;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return false;
  return email.toLowerCase() === adminEmail.toLowerCase();
}

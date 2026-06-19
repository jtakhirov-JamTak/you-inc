/**
 * CSRF origin check for API routes (writes + user-scoped enumeration GETs).
 *
 * Primary signal: `Sec-Fetch-Site`. Modern browsers (Chrome 76+, Firefox 90+,
 * Safari 16.4+) set it on every request including top-level navigations —
 * `<a download>`, form submit, bookmark click, URL-bar paste, fetch/XHR.
 * It's on the Fetch spec's forbidden-header list, so page JS can't spoof it.
 *
 * Fallback: same-host `Origin` vs `Host`. Used when `Sec-Fetch-Site` is
 * absent (older Safari etc.). `Origin` is unreliable on same-origin GET
 * navigations — which broke `/api/export` via `<a href download>` before
 * the Sec-Fetch-Site signal was added.
 *
 * Accepts: `same-origin` (page-initiated, including <a download>),
 *          `none` (direct user action: typed URL, bookmark — GETs only in
 *          practice, since POST can't originate from those surfaces).
 * Rejects: `same-site` (subdomain — defense in depth; app has no subdomains),
 *          `cross-site` (attacker's page).
 */
export function checkOrigin(req: Request): boolean {
  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite) {
    return secFetchSite === "same-origin" || secFetchSite === "none";
  }

  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

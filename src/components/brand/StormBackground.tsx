// Storm page background (§2) — the radial sky-glow over a vertical navy
// fall-off, as a fixed -z-10 layer. Replaces the light SkyBackground/cloud
// motif on restyled pages. The gradient itself lives in `--background`
// (globals.css) so there is a single source of truth; this just paints it as a
// fixed layer for pages/overlays that don't inherit the body background.
export function StormBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10"
      style={{ background: "var(--background)" }}
    />
  );
}

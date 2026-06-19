/**
 * Shared Storm text-input class. One source of truth for every email / text /
 * password field (login, signup, settings) so the styling — and critically the
 * `text-base` (16px) rule that stops iOS Safari zooming on focus — can't drift
 * per-form.
 *
 * Placeholder is `ink-soft`, not `ink-muted`: a format-example placeholder is
 * readable content, and ink-muted on the surface fails AA (~3.1:1).
 *
 * Layout spacing (e.g. `mt-1.5`) and per-form surface overrides (e.g.
 * `bg-surface-tint`) are NOT baked in — compose them at the call site with
 * `cn(inputClass, "mt-1.5")`. twMerge lets a later `bg-*` override the default.
 */
export const inputClass =
  "block h-12 w-full rounded-input border border-hairline bg-surface px-4 text-base text-ink placeholder:text-ink-soft focus:outline-none focus:ring-2 focus:ring-accent";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Pill-shaped accent CTA class — the app's primary call-to-action shape, used
 * on both <button>s (submit/generate) and <Link>s (auth, landing). Compose
 * height/width/text-size and the element at the call site:
 * `cn(pillAccentClass, "h-14 w-full text-[15px]")`. Baking the `disabled:`
 * states here keeps them from drifting across the ~12 call sites (they
 * previously did — some had disabled:shadow-none, some didn't).
 */
export const pillAccentClass =
  "flex items-center justify-center rounded-pill bg-accent font-bold text-accent-text shadow-cta transition active:scale-[0.98] disabled:opacity-40 disabled:shadow-none";

/**
 * Secondary action — surface fill, ink text, hairline border, ~48px. "Back",
 * "Skip", "Maybe later". Never accent (that's reserved for the one primary).
 */
export function SecondaryButton({
  children,
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type={type}
      className={cn(
        "flex h-12 items-center justify-center rounded-[14px] border border-hairline bg-surface text-[14px] font-semibold text-ink transition active:opacity-80 disabled:opacity-40",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

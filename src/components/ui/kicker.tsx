import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Mono uppercase label — the signature of the design system (§3). JetBrains
 * Mono, ~10px, weight 500, UPPERCASE, letter-spacing 1.3. Used for every
 * section label, step counter, eyebrow, and metric.
 *
 * Default color is ink-soft, not ink-muted: §2 forbids ink-muted on a surface
 * for anything the user must read, and a kicker is a label, not decoration.
 * Pass `className="text-accent-ink"` for the active/accent variant.
 *
 * `as` lets a kicker that is a true SECTION HEADING (e.g. a card's "Your
 * weekly reflection" label) render as an <h2>/<h3> so it stays in the
 * screen-reader heading outline. Decorative eyebrows keep the default <span>.
 * Tailwind preflight resets heading margin/size, so an <h2> looks identical.
 */
export function Kicker({
  children,
  className,
  as: Tag = "span",
}: {
  children: ReactNode;
  className?: string;
  as?: "span" | "h2" | "h3" | "p";
}) {
  return (
    <Tag
      className={cn(
        "font-mono text-[10px] font-medium uppercase leading-none tracking-[1.3px] text-ink-soft",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

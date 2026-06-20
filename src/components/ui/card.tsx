import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Card — white surface on cream, 14px radius, 1px border (#E6E0D4), 14–16px
 * padding. No drop shadow: the handoff floats cards via border + bg contrast,
 * not shadow. Variants: `accent` = ink fill (dark-on-cream chrome / the
 * Identity default-mode card), `warm` = the gold Sprints "investment" tint.
 */
export function Card({
  children,
  className,
  variant = "surface",
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  variant?: "surface" | "accent" | "warm";
}) {
  return (
    <div
      className={cn(
        "rounded-card border p-4",
        variant === "surface" && "border-hairline bg-surface",
        variant === "accent" && "border-transparent bg-accent text-accent-text",
        variant === "warm" && "border-transparent bg-warm-soft",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

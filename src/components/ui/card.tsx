import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Storm card (§4) — flat #1E2A3B surface, 18px radius, 1px hairline border,
 * 14–16px padding. No drop shadow (Storm differentiates with hairlines +
 * typography, not shadows). Variants tint the fill/border for accent or warm
 * callouts while keeping the same flat treatment.
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

import { cn } from "@/lib/utils";

// 32dp rounded-square category chip for habit positions (design handoff §Home /
// §Habits). Each cadence has its own tint; liabilities (vices) use the warm-red
// tint with a "↓" mark. Tints are design tokens (globals.css), so the colors
// live in one place.
type BadgeKind = "morning" | "daily" | "weekly" | "liability";

const STYLE: Record<BadgeKind, { cls: string; label: string }> = {
  morning: { cls: "bg-badge-morning-bg text-badge-morning-ink", label: "AM" },
  daily: { cls: "bg-badge-daily-bg text-badge-daily-ink", label: "DAY" },
  weekly: { cls: "bg-badge-weekly-bg text-badge-weekly-ink", label: "WK" },
  liability: { cls: "bg-badge-liability-bg text-badge-liability-ink", label: "↓" },
};

/** Resolve a habit's badge kind from kind+cadence. */
export function badgeKindFor(kind: "asset" | "liability", cadence: string | null): BadgeKind {
  if (kind === "liability") return "liability";
  if (cadence === "morning") return "morning";
  if (cadence === "weekly") return "weekly";
  return "daily";
}

export function CategoryBadge({ kind, className }: { kind: BadgeKind; className?: string }) {
  const { cls, label } = STYLE[kind];
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] font-mono text-[10px] font-semibold leading-none tracking-[0.04em]",
        cls,
        className,
      )}
    >
      {label}
    </span>
  );
}

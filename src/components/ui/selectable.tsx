import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Selectable row (§4) — surface by default; selected = accent fill + check +
 * dark accent-text. Min height 44px (iOS tap target). Used for option lists
 * (relationship, conversation move, emotion, etc.).
 *
 * Selection and advancing are deliberately separate taps: this only toggles
 * the value. Auto-advancing a select into a submit in the same tick is the
 * documented set-then-submit stale-state trap — keep the explicit Next button.
 */
export function SelectableRow({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex min-h-12 w-full items-center justify-between gap-3 rounded-[14px] px-4 py-3 text-left text-[14px] font-medium transition active:scale-[0.99]",
        selected
          ? "bg-accent text-accent-text"
          : "border border-hairline bg-surface text-ink",
        className,
      )}
    >
      <span className="min-w-0">{children}</span>
      {selected && <Check className="h-[18px] w-[18px] shrink-0" strokeWidth={2.5} />}
    </button>
  );
}

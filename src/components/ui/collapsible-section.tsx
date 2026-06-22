"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// A single collapsible section used across the charter-style screens (Mission,
// Strategy, Systems). The `summary` line stays visible in the header whether the
// section is open or closed; the `children` panel only renders when expanded.
// Accessible: a real <button> header with aria-expanded/aria-controls, a ≥44px
// tap target, and a chevron that rotates on open.
export function CollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  headerRight,
  children,
}: {
  title: string;
  summary: ReactNode;
  defaultOpen?: boolean;
  // Optional control rendered at the right of the header, before the chevron
  // (e.g. an Edit affordance). Rendered outside the toggle button.
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <section className="overflow-hidden rounded-card border border-hairline bg-surface">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-h-[56px] flex-1 items-center gap-3 px-4 py-3 text-left transition active:scale-[0.99]"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-ink-muted">
              {title}
            </span>
            <span className="mt-1 block text-[14px] font-bold leading-snug text-ink">{summary}</span>
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-ink-soft transition-transform duration-200",
              open && "rotate-180",
            )}
            strokeWidth={2.25}
            aria-hidden
          />
        </button>
        {headerRight && <div className="flex items-center pr-3">{headerRight}</div>}
      </div>
      {open && (
        <div id={panelId} className="border-t border-divider px-4 pb-4 pt-3.5">
          {children}
        </div>
      )}
    </section>
  );
}

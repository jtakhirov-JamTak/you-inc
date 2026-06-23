"use client";

import { cn } from "@/lib/utils";
import { inputClass } from "@/components/ui/field";

// Shared form atoms for the year-goal screens (the guided flow + the quick-edit
// form), so the field label and the If/Then input pair aren't defined twice.

// Mono eyebrow label. ink-soft (not ink-muted) — it's the only label each field
// carries, so it must clear AA contrast (the project's a11y baseline forbids
// ink-muted on readable text).
export function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-soft">
      {children}
    </span>
  );
}

// One if–then plan: an IF trigger row + a THEN action row. 16px inputs so iOS
// doesn't zoom on focus. Each input carries its own aria-label (the visible
// "If"/"Then" prefix isn't a programmatic <label>).
export function IfThenFields({
  n,
  trigger,
  action,
  onTrigger,
  onAction,
}: {
  n: number;
  trigger: string;
  action: string;
  onTrigger: (v: string) => void;
  onAction: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="w-9 shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-soft">
          If
        </span>
        <input
          type="text"
          value={trigger}
          onChange={(e) => onTrigger(e.target.value)}
          maxLength={150}
          placeholder="specific trigger"
          aria-label={`If-then ${n}: trigger`}
          className={cn(inputClass, "h-11 text-[16px]")}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-9 shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-soft">
          Then
        </span>
        <input
          type="text"
          value={action}
          onChange={(e) => onAction(e.target.value)}
          maxLength={150}
          placeholder="small immediate action"
          aria-label={`If-then ${n}: action`}
          className={cn(inputClass, "h-11 text-[16px]")}
        />
      </div>
    </div>
  );
}

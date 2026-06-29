"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// One sprint-task checkbox. Ticking POSTs /api/sprints/task {taskId, done:!done}
// then refreshes the server-derived view. A milestone that has ended unticked is
// "overdue" (gold/danger styling) — matches the price engine's day-of-term rule.
// Lives in components/sprints so both Home (where ticking now happens) and any
// other surface can render it; Strategy no longer renders it.
export function TaskToggle({
  sprintId,
  taskId,
  title,
  done,
  dueDay,
  dayOfTerm,
}: {
  sprintId: string;
  taskId: string;
  title: string;
  done: boolean;
  dueDay: number | null;
  dayOfTerm: number;
}): React.ReactElement {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  // A milestone "has ended" once today is strictly past it (matches the engine).
  const overdue = !done && dueDay != null && dayOfTerm > dueDay;

  async function tap() {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      const res = await fetch("/api/sprints/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, done: !done }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={tap}
      disabled={pending}
      aria-pressed={done}
      aria-busy={pending}
      aria-label={`${title}${dueDay != null ? `, milestone day ${dueDay}` : ""}${
        done ? ", done — tap to undo" : overdue ? ", milestone passed — tap to mark done" : ", tap to mark done"
      }`}
      data-sprint={sprintId}
      className="flex min-h-11 w-full items-center gap-2.5 rounded-card-sm border border-gold-border bg-surface px-3 py-2 text-left transition active:scale-[0.99] disabled:opacity-50"
    >
      <span
        aria-hidden
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border",
          done ? "border-transparent bg-positive text-white" : "border-gold-border bg-surface",
        )}
      >
        {done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px] font-medium",
          done ? "text-ink-soft line-through" : "text-ink",
        )}
      >
        {title}
      </span>
      {dueDay != null && !failed && (
        <span
          className={cn(
            "shrink-0 font-mono text-[9px] uppercase tracking-[0.08em]",
            done ? "text-ink-soft" : overdue ? "text-danger" : "text-gold-label",
          )}
        >
          {overdue ? `Day ${dueDay} · past` : `Day ${dueDay}`}
        </span>
      )}
      {failed && (
        <span role="status" className="shrink-0 text-[11px] font-semibold text-danger">
          Couldn’t save — retry
        </span>
      )}
    </button>
  );
}

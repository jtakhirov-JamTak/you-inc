"use client";

import { deriveTicker } from "@/lib/habits/ticker";
import {
  SprintsBoard,
  type ActiveSprintView,
  type QueuedSprintView,
  type ClosedSprintView,
} from "./sprints-board";

// Strategy — your 10–14 day pushes. The year goal has been removed; its guided
// visualization now lives inside sprint creation (SprintFlow). This screen is
// just the sprint board: the active card (read-only summary; task ticking moved
// to Home), the queue, and the closed history. The operating value and the
// active/queued figures all come from getOperatingState (server-derived).

const AREA_LABEL: Record<string, string> = {
  health: "Health",
  wealth: "Wealth",
  relationships: "Relationships",
};

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded-[5px] border border-hairline px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-[0.08em] text-ink-soft">
      {children}
    </span>
  );
}

function dueLabel(active: ActiveSprintView): string {
  const daysLeft = Math.max(0, active.termDays - active.dayOfTerm);
  return daysLeft === 0 ? "today" : `in ${daysLeft}d`;
}

export function StrategyScreen({
  basisCents,
  active,
  queued,
  closed,
}: {
  basisCents: number;
  active: ActiveSprintView | null;
  queued: QueuedSprintView[];
  closed: ClosedSprintView[];
}) {
  return (
    <div className="space-y-2.5 pb-12">
      {active && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-0.5 text-[11.5px] text-ink-soft">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate font-semibold text-ink">{active.thesis}</span>
            <Tag>{deriveTicker(active.thesis, new Set())}</Tag>
          </span>
          <span>
            <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-muted">
              Area{" "}
            </span>
            {AREA_LABEL[active.area] ?? active.area}
          </span>
          <span>
            <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-muted">
              Due{" "}
            </span>
            {dueLabel(active)}
          </span>
        </div>
      )}
      <SprintsBoard basisCents={basisCents} active={active} queued={queued} closed={closed} />
    </div>
  );
}

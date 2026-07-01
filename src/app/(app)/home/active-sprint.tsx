"use client";

import Link from "next/link";
import { TaskToggle } from "@/components/sprints/task-toggle";
import { formatSignedDollars } from "@/lib/utils";
import type { HomeSprint } from "@/lib/price/runner";

// ActiveSprint — Home's investment card. Renders the active sprint as the gold
// card (the only gold figure block on Home) PLUS its task checklist, so the daily
// milestone ticking happens here. No Close button — closing a sprint stays on
// Strategy. Queued sprints render below as slim rows. Pure presentation over the
// engine-derived HomeSprint shape; TaskToggle owns its own POST + refresh.

const AREA_LABEL: Record<string, string> = {
  health: "Health",
  wealth: "Wealth",
  relationships: "Relationships",
};

const SIZE_LABEL: Record<string, string> = {
  small: "Small",
  medium: "Medium",
  big: "Big",
};

function ActiveSprintCard({ s }: { s: HomeSprint }) {
  const pct =
    s.dayOfTerm && s.termDays ? Math.min(100, Math.round((s.dayOfTerm / s.termDays) * 100)) : 0;
  // Dollar figure only once the term has elapsed (unrealizedReturnCents non-null).
  // While the sprint is still running, show task-completion % instead (founder ruling).
  const termElapsed = s.unrealizedReturnCents != null;
  const ret = s.unrealizedReturnCents ?? 0;
  const taskPct = s.totalTasks > 0 ? Math.round((s.completedTasks / s.totalTasks) * 100) : 0;
  return (
    <div className="rounded-card border border-gold-border bg-gold-bg p-4">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[13.5px] font-bold leading-none tracking-[0.04em] text-gold-deep">
          {s.ticker}
        </span>
        <span className="rounded-[6px] border border-gold-border bg-gold-bg px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase tracking-[0.08em] text-gold-label">
          Day {s.dayOfTerm ?? 0} / {s.termDays}
        </span>
      </div>
      <h3 className="mt-2 text-[18px] font-bold leading-tight text-ink">{s.thesis}</h3>
      <p className="mt-0.5 text-[11px] text-gold-deep">
        {SIZE_LABEL[s.size] ?? s.size} · {AREA_LABEL[s.area] ?? s.area}
      </p>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-[3px] bg-gold-border"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`${s.thesis} — day ${s.dayOfTerm ?? 0} of ${s.termDays}`}
      >
        <div className="h-full rounded-[3px] bg-warm" style={{ width: `${pct}%` }} />
      </div>
      {termElapsed ? (
        <div className="mt-2.5 flex items-baseline justify-between">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-gold-label">
            Return · close on Strategy
          </span>
          <span
            className={`font-mono text-[14px] font-semibold tabular-nums ${
              ret > 0 ? "text-positive" : "text-gold-deep"
            }`}
          >
            {formatSignedDollars(ret)}
          </span>
        </div>
      ) : (
        <div className="mt-2.5 flex items-baseline justify-between">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-gold-label">
            Tasks
          </span>
          <span className="font-mono text-[14px] font-semibold tabular-nums text-gold-deep">
            {s.completedTasks} / {s.totalTasks} · {taskPct}%
          </span>
        </div>
      )}

      {/* Task checklist — the daily milestone tap targets (close stays on Strategy). */}
      {s.tasks.length > 0 && (
        <div className="mt-3 space-y-2">
          {s.tasks.map((t) => (
            <TaskToggle
              key={t.id}
              sprintId={s.sprintId}
              taskId={t.id}
              title={t.title}
              done={t.done}
              dueDay={t.dueDay}
              dayOfTerm={s.dayOfTerm ?? 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QueuedSprintRow({ s }: { s: HomeSprint }) {
  return (
    <div className="flex items-center justify-between rounded-card-sm border border-hairline bg-surface p-3.5">
      <div className="min-w-0">
        <p className="font-mono text-[12px] font-bold leading-none tracking-[0.04em] text-ink-soft">
          {s.ticker}
        </p>
        <p className="mt-1 truncate text-[12.5px] font-semibold text-ink">{s.thesis}</p>
        <p className="mt-0.5 text-[10.5px] text-ink-soft">
          Queued · toward {AREA_LABEL[s.area] ?? s.area}
        </p>
      </div>
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">
        Starts {s.startsInDays ?? 0}d
      </span>
    </div>
  );
}

export function ActiveSprint({
  sprint,
  queued,
}: {
  sprint: HomeSprint | null;
  queued: HomeSprint[];
}) {
  return (
    <section className="mt-6">
      <h2 className="px-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft">
        Sprint
      </h2>
      <div className="mt-2.5 space-y-2.5">
        {sprint ? (
          <ActiveSprintCard s={sprint} />
        ) : (
          <div className="rounded-card border border-hairline bg-surface p-5">
            <p className="text-[14px] font-medium leading-[1.5] text-ink-soft">
              No active sprint — start one on{" "}
              <Link href="/sprints" className="text-ink underline">
                Strategy
              </Link>
              .
            </p>
          </div>
        )}
        {queued.map((s) => (
          <QueuedSprintRow key={s.sprintId} s={s} />
        ))}
      </div>
    </section>
  );
}

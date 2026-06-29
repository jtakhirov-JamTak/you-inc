"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn, formatSignedDollars } from "@/lib/utils";
import { Kicker } from "@/components/ui/kicker";
import { pillAccentClass, SecondaryButton } from "@/components/ui/button";
import { SprintFlow } from "./sprint-flow";
import type { SprintSize } from "@/lib/price/config";

export interface ActiveSprintView {
  sprintId: string;
  size: SprintSize;
  area: string;
  thesis: string;
  termDays: number;
  dayOfTerm: number;
  completedTasks: number;
  totalTasks: number;
  unrealizedReturnCents: number;
  tasks: { id: string; title: string; done: boolean; dueDay: number | null }[];
}
export interface QueuedSprintView {
  sprintId: string;
  size: SprintSize;
  area: string;
  thesis: string;
  termDays: number;
  startsInDays: number;
}
export interface ClosedSprintView {
  id: string;
  size: string;
  area: string;
  thesis: string;
  realizedBand: string | null;
  realizedAmountCents: number | null;
  goalAchieved: boolean | null;
  closedAt: string | null;
}

const AREA_LABEL: Record<string, string> = {
  health: "Health",
  wealth: "Wealth",
  relationships: "Relationships",
};
const SIZE_LABEL: Record<SprintSize, string> = { small: "Small", medium: "Medium", big: "Big" };

export function SprintsBoard({
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
  // The guided sprint-creation flow (full-screen takeover), opened on demand.
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-7">
      {/* Active investment */}
      <section className="mt-6">
        <div className="flex items-baseline justify-between px-0.5">
          <Kicker as="h2" className="tracking-[0.12em]">
            Active investment
          </Kicker>
          <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-warm">
            {active ? "1 ACTIVE" : "0 ACTIVE"}
          </span>
        </div>

        {active ? (
          <ActiveSprint s={active} />
        ) : (
          <div className="mt-2.5 rounded-card border border-hairline bg-surface p-5">
            <p className="text-[14px] font-medium leading-[1.5] text-ink-soft">
              No active investment. Start a sprint below — a 10–14 day push — and its return books to
              your value at close.
            </p>
          </div>
        )}
      </section>

      {/* Queue */}
      {queued.length > 0 && (
        <section>
          <Kicker as="h2" className="px-0.5 tracking-[0.12em]">
            Queue · {queued.length}
          </Kicker>
          <div className="mt-2.5 space-y-2.5">
            {queued.map((s) => (
              <div
                key={s.sprintId}
                className="flex items-center justify-between rounded-card-sm border border-hairline bg-surface p-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-ink">{s.thesis}</p>
                  <p className="mt-0.5 text-[11px] text-ink-soft">
                    {SIZE_LABEL[s.size]} · toward {AREA_LABEL[s.area] ?? s.area}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">
                  Starts {s.startsInDays}d
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Create / queue another — opens the guided full-screen flow */}
      <section>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-card border border-dashed border-gold-border bg-gold-bg/40 px-4 py-3 text-[13.5px] font-semibold text-gold-deep transition active:scale-[0.99]"
        >
          <span aria-hidden className="text-[18px] font-light leading-none">
            +
          </span>
          {active ? "Queue another sprint" : "Start a sprint"}
        </button>
      </section>

      {creating && (
        <SprintFlow
          basisCents={basisCents}
          hasActive={!!active}
          onClose={() => setCreating(false)}
        />
      )}

      {/* Closed history */}
      {closed.length > 0 && (
        <section>
          <Kicker as="h2" className="px-0.5 tracking-[0.12em]">
            Closed
          </Kicker>
          <div className="mt-2.5 rounded-card border border-hairline bg-surface px-4">
            <div className="divide-y divide-divider">
              {closed.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-ink">{c.thesis}</p>
                    <p className="mt-0.5 text-[11px] text-ink-soft">
                      {SIZE_LABEL[c.size as SprintSize] ?? c.size} · {c.realizedBand ?? "—"} of tasks
                      {c.goalAchieved ? " · goal hit" : ""}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[13px] font-semibold tabular-nums",
                      (c.realizedAmountCents ?? 0) > 0
                        ? "text-positive"
                        : (c.realizedAmountCents ?? 0) < 0
                          ? "text-danger"
                          : "text-ink-soft",
                    )}
                  >
                    {formatSignedDollars(c.realizedAmountCents ?? 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

// ── Active sprint card (gold treatment) ─────────────────────────────────────────
function ActiveSprint({ s }: { s: ActiveSprintView }) {
  const router = useRouter();
  const pct = s.termDays ? Math.min(100, Math.round((s.dayOfTerm / s.termDays) * 100)) : 0;
  const ret = s.unrealizedReturnCents;
  const retTone = ret > 0 ? "text-positive" : ret < 0 ? "text-danger" : "text-gold-deep";

  return (
    <div className="mt-2.5 rounded-card border border-gold-border bg-gold-bg p-4">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-gold-label">
          Active · 10–14 day push
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-gold-label">
          Day {s.dayOfTerm} / {s.termDays}
        </span>
      </div>
      <h3 className="mt-2 text-[18px] font-bold leading-tight text-ink">{s.thesis}</h3>
      <p className="mt-0.5 text-[11px] text-gold-deep">
        {SIZE_LABEL[s.size]} · invested toward {AREA_LABEL[s.area] ?? s.area}
      </p>

      <div className="mt-3 h-1.5 overflow-hidden rounded-[3px] bg-gold-border">
        <div className="h-full rounded-[3px] bg-warm" style={{ width: `${pct}%` }} />
      </div>

      {/* Task ticking moved to Home — the Strategy card stays a read-only summary.
          A completion count keeps the payoff context visible here. */}
      <div className="mt-3 font-mono text-[9px] uppercase tracking-[0.1em] text-gold-label">
        Tasks · {s.completedTasks} / {s.totalTasks} done · tick them on Home
      </div>

      <div className="mt-4 flex items-end justify-between border-t border-gold-border pt-3">
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-gold-label">
            Unrealized return
          </div>
          <div className={cn("mt-1 font-mono text-[20px] font-semibold tabular-nums", retTone)}>
            {formatSignedDollars(ret)}
          </div>
        </div>
        <CloseSprint sprintId={s.sprintId} onDone={() => router.refresh()} />
      </div>
    </div>
  );
}

function CloseSprint({ sprintId, onDone }: { sprintId: string; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function close(goalAchieved: boolean) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/sprints/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sprintId, goalAchieved }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Could not close this sprint.");
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  if (!confirming) {
    return (
      <SecondaryButton onClick={() => setConfirming(true)} className="h-11 px-4 text-[13px]">
        Close & settle
      </SecondaryButton>
    );
  }

  return (
    // role=status so a screen reader announces the confirm step when it appears
    // (focus otherwise stays on the now-removed "Close & settle" button).
    <div className="w-full max-w-[240px]" role="status" aria-live="polite">
      <p className="text-right text-[11.5px] font-medium leading-snug text-ink">
        Did this sprint hit its goal?
      </p>
      <p className="mt-0.5 text-right text-[11px] leading-snug text-ink-soft">
        This sprint’s own goal — not your 1-year goal.
      </p>
      {error && (
        <p role="alert" className="mt-1.5 text-right text-[11px] font-medium text-danger">
          {error}
        </p>
      )}
      <div className="mt-2 flex justify-end gap-1.5">
        <button
          type="button"
          disabled={submitting}
          onClick={() => close(false)}
          className="min-h-11 rounded-pill border border-hairline bg-surface px-3 text-[12px] font-semibold text-ink-soft disabled:opacity-50"
        >
          No
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => close(true)}
          className={cn(pillAccentClass, "min-h-11 px-4 text-[12px]")}
        >
          {submitting ? "…" : "Yes"}
        </button>
      </div>
    </div>
  );
}

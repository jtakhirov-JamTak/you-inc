"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDollars, formatSignedDollars } from "@/lib/utils";
import { Kicker } from "@/components/ui/kicker";
import { TextArea } from "@/components/ui/text-area";
import { pillAccentClass, SecondaryButton } from "@/components/ui/button";
import { buildSprintGrid } from "@/lib/price/engine";
import type { SprintSize } from "@/lib/price/config";

type Area = "health" | "wealth" | "relationships";

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
const SIZES: SprintSize[] = ["small", "medium", "big"];
const AREAS: Area[] = ["health", "wealth", "relationships"];
const TERMS = [10, 11, 12, 13, 14] as const;

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
  // The create form opens automatically when there's nothing in flight.
  const [creating, setCreating] = useState(!active && queued.length === 0);

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
              No active investment. Start a sprint below — a 10–14 day push toward a year goal — and
              its return books to your value at close.
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
                  <p className="mt-0.5 text-[10.5px] text-ink-soft">
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

      {/* Create / queue another */}
      <section>
        {creating ? (
          <CreateSprintForm
            basisCents={basisCents}
            hasActive={!!active}
            onDone={() => setCreating(false)}
            onCancel={() => setCreating(false)}
          />
        ) : (
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
        )}
      </section>

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
                    <p className="mt-0.5 text-[10.5px] text-ink-soft">
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
      <p className="mt-0.5 text-[11px] text-[#8a7a4e]">
        {SIZE_LABEL[s.size]} · invested toward {AREA_LABEL[s.area] ?? s.area}
      </p>

      <div className="mt-3 h-1.5 overflow-hidden rounded-[3px] bg-gold-border">
        <div className="h-full rounded-[3px] bg-warm" style={{ width: `${pct}%` }} />
      </div>

      {/* Task checklist — completion drives the payoff band. */}
      <div className="mt-4 space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-gold-label">
            Tasks · {s.completedTasks} / {s.totalTasks}
          </span>
        </div>
        {s.tasks.map((t) => (
          <TaskToggle
            key={t.id}
            sprintId={s.sprintId}
            taskId={t.id}
            title={t.title}
            done={t.done}
            dueDay={t.dueDay}
            dayOfTerm={s.dayOfTerm}
          />
        ))}
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

function TaskToggle({
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
}) {
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
      aria-label={`${title}${dueDay != null ? `, milestone day ${dueDay}` : ""}${
        done ? ", done — tap to undo" : overdue ? ", milestone passed — tap to mark done" : ", tap to mark done"
      }`}
      data-sprint={sprintId}
      className="flex min-h-11 w-full items-center gap-2.5 rounded-card-sm border border-gold-border bg-surface/60 px-3 py-2 text-left transition active:scale-[0.99] disabled:opacity-50"
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
            done ? "text-ink-faint" : overdue ? "text-danger" : "text-gold-label",
          )}
        >
          {overdue ? `Day ${dueDay} · past` : `Day ${dueDay}`}
        </span>
      )}
      {failed && (
        <span role="status" className="shrink-0 text-[11px] font-semibold text-danger">
          Retry
        </span>
      )}
    </button>
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
    <div className="w-full max-w-[230px]">
      <p className="text-right text-[11.5px] font-medium leading-snug text-ink">
        Did you achieve the year-goal thesis?
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

// ── Create form ─────────────────────────────────────────────────────────────────
function CreateSprintForm({
  basisCents,
  hasActive,
  onDone,
  onCancel,
}: {
  basisCents: number;
  hasActive: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [size, setSize] = useState<SprintSize>("medium");
  const [area, setArea] = useState<Area>("health");
  const [term, setTerm] = useState<(typeof TERMS)[number]>(12);
  const [thesis, setThesis] = useState("");
  const [tasks, setTasks] = useState<{ title: string; dueDay: number }[]>([
    { title: "", dueDay: 12 },
    { title: "", dueDay: 12 },
    { title: "", dueDay: 12 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanTasks = tasks
    .filter((t) => t.title.trim())
    .map((t) => ({ title: t.title.trim(), dueDay: Math.min(t.dueDay, term) }));
  const canSubmit = !!thesis.trim() && cleanTasks.length > 0 && !submitting;

  // Live finalize preview — the locked envelope at TODAY's balance (recomputed
  // client-side from the same pure grid the server freezes at create).
  const grid = buildSprintGrid(size, basisCents);

  function setTaskTitle(i: number, v: string) {
    setTasks((prev) => prev.map((t, idx) => (idx === i ? { ...t, title: v } : t)));
  }
  function setTaskDueDay(i: number, day: number) {
    setTasks((prev) => prev.map((t, idx) => (idx === i ? { ...t, dueDay: day } : t)));
  }
  function addTask() {
    setTasks((prev) => (prev.length >= 12 ? prev : [...prev, { title: "", dueDay: term }]));
  }
  function removeTask(i: number) {
    setTasks((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }
  // Keep every milestone within the term when the term shrinks.
  function changeTerm(t: (typeof TERMS)[number]) {
    setTerm(t);
    setTasks((prev) => prev.map((task) => (task.dueDay > t ? { ...task, dueDay: t } : task)));
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/sprints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size, area, thesis: thesis.trim(), termDays: term, tasks: cleanTasks }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Could not start this sprint.");
      }
      onDone();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-card border border-gold-border bg-gold-bg p-4">
      <Kicker className="tracking-[0.12em] text-gold-label">
        {hasActive ? "Queue a sprint" : "Start a sprint"}
      </Kicker>

      {/* Size */}
      <div className="mt-3">
        <Kicker>Size</Kicker>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {SIZES.map((sz) => (
            <Chip key={sz} active={size === sz} onClick={() => setSize(sz)}>
              {SIZE_LABEL[sz]}
            </Chip>
          ))}
        </div>
      </div>

      {/* Area */}
      <div className="mt-3">
        <Kicker>Area</Kicker>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {AREAS.map((a) => (
            <Chip key={a} active={area === a} onClick={() => setArea(a)}>
              {AREA_LABEL[a]}
            </Chip>
          ))}
        </div>
      </div>

      {/* Thesis */}
      <div className="mt-3">
        <Kicker>Thesis</Kicker>
        <div className="mt-1.5">
          <TextArea
            value={thesis}
            onChange={setThesis}
            placeholder="If I do X, the year goal becomes real."
            rows={2}
            maxLength={280}
            ariaLabel="Sprint thesis"
          />
        </div>
      </div>

      {/* Term — set before tasks so the milestone day pickers know their range. */}
      <div className="mt-3">
        <Kicker>Term</Kicker>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {TERMS.map((t) => (
            <Chip key={t} active={term === t} onClick={() => changeTerm(t)}>
              {t}d
            </Chip>
          ))}
        </div>
      </div>

      {/* Tasks — each carries a milestone day; a missed milestone is what books a
          negative on the live unrealized return (not before its day ends). */}
      <div className="mt-3">
        <Kicker>Tasks · set each milestone day</Kicker>
        <div className="mt-1.5 space-y-1.5">
          {tasks.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={t.title}
                maxLength={120}
                onChange={(e) => setTaskTitle(i, e.target.value)}
                placeholder={`Task ${i + 1}`}
                aria-label={`Task ${i + 1} title`}
                className="min-h-11 w-full rounded-card-sm border border-divider bg-surface px-3 text-[16px] text-ink placeholder:text-ink-soft focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <select
                value={t.dueDay}
                onChange={(e) => setTaskDueDay(i, Number(e.target.value))}
                aria-label={`Task ${i + 1} milestone day`}
                className="min-h-11 shrink-0 rounded-card-sm border border-divider bg-surface px-2 text-[16px] text-ink focus:outline-none focus:ring-2 focus:ring-accent"
              >
                {Array.from({ length: term }, (_, d) => d + 1).map((d) => (
                  <option key={d} value={d}>
                    Day {d}
                  </option>
                ))}
              </select>
              {tasks.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeTask(i)}
                  aria-label={`Remove task ${i + 1}`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card-sm border border-hairline bg-surface text-[18px] leading-none text-ink-soft"
                >
                  −
                </button>
              )}
            </div>
          ))}
        </div>
        {tasks.length < 12 && (
          <button
            type="button"
            onClick={addTask}
            className="mt-1.5 min-h-11 text-[12px] font-semibold text-gold-deep underline"
          >
            + Add task
          </button>
        )}
      </div>

      {/* Finalize preview — the locked envelope at today's balance. */}
      <div className="mt-4 rounded-card-sm border border-gold-border bg-surface/70 p-3">
        <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-gold-label">
          Locked at today&apos;s {formatDollars(basisCents)}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10.5px] text-ink-soft">Complete this →</div>
            <div className="font-mono text-[15px] font-semibold tabular-nums text-positive">
              {formatSignedDollars(grid.bestCents)}
            </div>
          </div>
          <div>
            <div className="text-[10.5px] text-ink-soft">Miss entirely →</div>
            <div className="font-mono text-[15px] font-semibold tabular-nums text-danger">
              {formatSignedDollars(grid.worstCents)}
            </div>
          </div>
        </div>
        <p className="mt-2 text-[10.5px] leading-snug text-ink-soft">
          Books to your operating value only at close. Partial completion lands on the grid in
          between.
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-[10px] bg-surface px-3 py-2 text-[13px] font-medium text-danger">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <SecondaryButton onClick={onCancel} className="flex-1">
          Cancel
        </SecondaryButton>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className={cn(pillAccentClass, "h-12 flex-1 text-[14px]")}
        >
          {submitting ? "Starting…" : hasActive ? "Queue sprint" : "Start sprint"}
        </button>
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "min-h-11 rounded-pill border px-3.5 text-[13px] font-semibold transition active:scale-95",
        active ? "border-transparent bg-accent text-accent-text" : "border-gold-border bg-surface text-ink-soft",
      )}
    >
      {children}
    </button>
  );
}

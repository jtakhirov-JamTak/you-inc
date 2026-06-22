"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { inputClass } from "@/components/ui/field";
import { TextArea } from "@/components/ui/text-area";
import { pillAccentClass } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { deriveTicker } from "@/lib/habits/ticker";
import {
  SprintsBoard,
  type ActiveSprintView,
  type QueuedSprintView,
  type ClosedSprintView,
} from "./sprints-board";

// Strategy — the year GOAL + the goal SPRINT, each a collapsible (mirrors the
// Mission charter). Collapsed shows the high-level; expand for detail. The Sprint
// section reuses the existing SprintsBoard (create/work/close) unchanged — the
// price engine path is untouched.

type Area = "health" | "wealth" | "relationships";
const AREAS: Area[] = ["health", "wealth", "relationships"];
const AREA_LABEL: Record<string, string> = {
  health: "Health",
  wealth: "Wealth",
  relationships: "Relationships",
};

export type YearGoalView = {
  title: string;
  area: string;
  description: string;
  targetDate: string;
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
  goal,
  basisCents,
  active,
  queued,
  closed,
}: {
  goal: YearGoalView | null;
  basisCents: number;
  active: ActiveSprintView | null;
  queued: QueuedSprintView[];
  closed: ClosedSprintView[];
}) {
  const hasGoal = !!goal && goal.title.trim().length > 0;

  const goalSummary = hasGoal ? (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 truncate">{goal!.title}</span>
      <Tag>{deriveTicker(goal!.title, new Set())}</Tag>
    </span>
  ) : (
    <span className="font-medium text-ink-muted">Set your year goal</span>
  );

  const sprintSummary = active ? (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 truncate">{active.thesis}</span>
      <Tag>{deriveTicker(active.thesis, new Set())}</Tag>
      <span className="shrink-0 font-mono text-[10px] font-medium text-ink-soft">
        Day {active.dayOfTerm}/{active.termDays}
      </span>
    </span>
  ) : (
    <span className="font-medium text-ink-muted">No active sprint</span>
  );

  return (
    <div className="space-y-2.5 pb-12">
      <CollapsibleSection title="Goal" summary={goalSummary}>
        <GoalPanel goal={goal} />
      </CollapsibleSection>

      <CollapsibleSection title="Sprint" summary={sprintSummary}>
        {active && (
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-soft">
            <span>
              <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-muted">
                Area{" "}
              </span>
              {AREA_LABEL[active.area] ?? active.area}
            </span>
            <span>
              <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-muted">
                Length{" "}
              </span>
              {active.termDays}-day
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
      </CollapsibleSection>
    </div>
  );
}

// Read view of the goal + an inline Edit form (Mission-style). Opens straight
// into the form when no goal has been authored yet.
function GoalPanel({ goal }: { goal: YearGoalView | null }) {
  const hasGoal = !!goal && goal.title.trim().length > 0;
  const [editing, setEditing] = useState(!hasGoal);

  if (editing) {
    return <GoalForm goal={goal} canCancel={hasGoal} onDone={() => setEditing(false)} />;
  }

  return (
    <div className="space-y-3">
      <Field label="Area" value={AREA_LABEL[goal!.area] ?? goal!.area} />
      {goal!.description.trim() && <Field label="Why" value={goal!.description} />}
      {goal!.targetDate.trim() && <Field label="Target" value={goal!.targetDate} />}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-[6px] border border-hairline px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-soft transition active:scale-95"
      >
        Edit goal
      </button>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-muted">
        {label}
      </span>
      <p className="mt-0.5 text-[13px] leading-snug text-ink">{value}</p>
    </div>
  );
}

function GoalForm({
  goal,
  canCancel,
  onDone,
}: {
  goal: YearGoalView | null;
  canCancel: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(goal?.title ?? "");
  const [area, setArea] = useState<Area>(
    (goal?.area as Area) && AREAS.includes(goal!.area as Area) ? (goal!.area as Area) : "health",
  );
  const [description, setDescription] = useState(goal?.description ?? "");
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = title.trim().length > 0 && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/year-goals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          area,
          description: description.trim(),
          targetDate: targetDate.trim(),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Could not save your goal.");
      }
      router.refresh();
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3.5">
      <div>
        <span className="mb-1 block font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-muted">
          Goal — in three words
        </span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={60}
          placeholder="e.g. Run a marathon"
          aria-label="Year goal"
          className={cn(inputClass, "h-12 text-[16px] font-bold tracking-[-0.01em]")}
        />
      </div>

      <div>
        <span className="mb-1 block font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-muted">
          Area
        </span>
        <div className="flex gap-2">
          {AREAS.map((a) => {
            const selected = area === a;
            return (
              <button
                key={a}
                type="button"
                onClick={() => setArea(a)}
                aria-pressed={selected}
                className={cn(
                  "min-h-11 flex-1 rounded-card-sm border px-2 text-[12px] font-semibold transition active:scale-95",
                  selected
                    ? "border-accent bg-accent text-accent-text"
                    : "border-divider bg-surface text-ink-soft",
                )}
              >
                {AREA_LABEL[a]}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <span className="mb-1 block font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-muted">
          Why it matters · optional
        </span>
        <TextArea
          value={description}
          onChange={setDescription}
          placeholder="What this unlocks, in your words…"
          rows={2}
          maxLength={300}
          ariaLabel="Why this goal matters"
        />
      </div>

      <div>
        <span className="mb-1 block font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-muted">
          Target date · optional
        </span>
        <input
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          aria-label="Target date"
          className={cn(inputClass, "h-12 text-[16px]")}
        />
      </div>

      {error && (
        <p role="alert" className="text-[13px] font-medium text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!canSave}
          onClick={save}
          className={cn(pillAccentClass, "h-12 flex-1 text-[14px]")}
        >
          {saving ? "Saving…" : "Save goal"}
        </button>
        {canCancel && (
          <button
            type="button"
            onClick={onDone}
            className="rounded-pill border border-hairline px-4 text-[13px] font-semibold text-ink-soft transition active:scale-95"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { inputClass } from "@/components/ui/field";
import { TextArea } from "@/components/ui/text-area";
import { pillAccentClass } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { GuidedVisualization } from "@/components/ui/guided-visualization";
import { deriveTicker } from "@/lib/habits/ticker";
import { Label, IfThenFields } from "./goal-shared";
import {
  GoalFlow,
  FUTURE_SCENE,
  FUTURE_END,
  OBSTACLE_SCENE,
  OBSTACLE_END,
} from "./goal-flow";
import {
  SprintsBoard,
  type ActiveSprintView,
  type QueuedSprintView,
  type ClosedSprintView,
} from "./sprints-board";

// Strategy — the year GOAL + the goal SPRINT, each a collapsible (mirrors the
// Mission charter). The Goal is authored via the guided 4-step flow (GoalFlow)
// the first time, and quick-edited inline afterward. Collapsed shows the success
// metric. The Sprint section reuses SprintsBoard unchanged.

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
  identityStatement: string;
  observableProof: string;
  successMetric: string;
  weeklyBehavior: string;
  obstacle: string;
  ifThen1Trigger: string;
  ifThen1Action: string;
  ifThen2Trigger: string;
  ifThen2Action: string;
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

  // Collapsed: show the success metric (the spec) — fall back to the title if a
  // legacy/in-progress goal has no metric yet. The ticker derives from the title.
  const metric = goal?.successMetric.trim() || goal?.title.trim() || "";
  const goalSummary = hasGoal ? (
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 truncate">{metric}</span>
      <Tag>{deriveTicker(goal!.title, new Set())}</Tag>
    </span>
  ) : (
    <span className="font-medium text-ink-soft">Set your year goal</span>
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
    <span className="font-medium text-ink-soft">No active sprint</span>
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

// Goal panel — three modes: launch the guided flow (no goal yet), read the
// authored goal, or quick-edit it (optionally with the visualizations replayed).
function GoalPanel({ goal }: { goal: YearGoalView | null }) {
  const hasGoal = !!goal && goal.title.trim().length > 0;
  const [flowOpen, setFlowOpen] = useState(false);
  const [editMode, setEditMode] = useState<null | "plain" | "viz">(null);

  if (!hasGoal) {
    return (
      <>
        <div className="space-y-3">
          <p className="text-[13px] leading-[1.5] text-ink-soft">
            A short guided flow: choose the one domain, picture the year ahead,
            commit to a weekly proof behavior, and name the obstacle that could
            stop you.
          </p>
          <button
            type="button"
            onClick={() => setFlowOpen(true)}
            className={cn(pillAccentClass, "h-12 w-full text-[14px]")}
          >
            Begin
          </button>
        </div>
        {flowOpen && <GoalFlow onClose={() => setFlowOpen(false)} />}
      </>
    );
  }

  if (editMode) {
    return (
      <GoalForm
        goal={goal}
        withVisualization={editMode === "viz"}
        onDone={() => setEditMode(null)}
      />
    );
  }

  return (
    <GoalReadView
      goal={goal!}
      onEdit={() => setEditMode("plain")}
      onReVisualize={() => setEditMode("viz")}
    />
  );
}

function GoalReadView({
  goal,
  onEdit,
  onReVisualize,
}: {
  goal: YearGoalView;
  onEdit: () => void;
  onReVisualize: () => void;
}) {
  const ifThen1 =
    goal.ifThen1Trigger.trim() && goal.ifThen1Action.trim()
      ? `If ${goal.ifThen1Trigger}, then ${goal.ifThen1Action}.`
      : "";
  const ifThen2 =
    goal.ifThen2Trigger.trim() && goal.ifThen2Action.trim()
      ? `If ${goal.ifThen2Trigger}, then ${goal.ifThen2Action}.`
      : "";

  return (
    <div className="space-y-3">
      <Field label="Area" value={AREA_LABEL[goal.area] ?? goal.area} />
      {goal.successMetric.trim() && (
        <Field label="Success metric" value={goal.successMetric} />
      )}
      {goal.identityStatement.trim() && (
        <Field
          label="In 12 months, you are the kind of person who"
          value={goal.identityStatement}
        />
      )}
      {goal.observableProof.trim() && (
        <Field label="Observable proof" value={goal.observableProof} />
      )}
      {goal.weeklyBehavior.trim() && (
        <Field label="Weekly proof behavior" value={goal.weeklyBehavior} />
      )}
      {goal.targetDate.trim() && <Field label="Due" value={goal.targetDate} />}
      {goal.obstacle.trim() && <Field label="Obstacle" value={goal.obstacle} />}
      {ifThen1 && <Field label="If–then" value={ifThen1} />}
      {ifThen2 && <Field label="If–then" value={ifThen2} />}
      {goal.description.trim() && <Field label="Why" value={goal.description} />}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-[6px] border border-hairline px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-soft transition active:scale-95"
        >
          Edit goal
        </button>
        <button
          type="button"
          onClick={onReVisualize}
          className="rounded-[6px] border border-hairline px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-soft transition active:scale-95"
        >
          Re-do visualization
        </button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-ink-soft">
        {label}
      </span>
      <p className="mt-0.5 text-[13px] leading-snug text-ink">{value}</p>
    </div>
  );
}

// Quick-edit form — edits the goal's TEXT fields only (PUT /api/year-goals).
// It never re-creates or replaces the weekly habit; that lives on Systems. When
// `withVisualization` is set, the two guided visualizations are replayed above
// the fields as a reflection aid (the boxes stay editable throughout).
function GoalForm({
  goal,
  withVisualization,
  onDone,
}: {
  goal: YearGoalView | null;
  withVisualization: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(goal?.title ?? "");
  const [area, setArea] = useState<Area>(
    (goal?.area as Area) && AREAS.includes(goal!.area as Area)
      ? (goal!.area as Area)
      : "health",
  );
  const [successMetric, setSuccessMetric] = useState(goal?.successMetric ?? "");
  const [identityStatement, setIdentityStatement] = useState(
    goal?.identityStatement ?? "",
  );
  const [observableProof, setObservableProof] = useState(
    goal?.observableProof ?? "",
  );
  const [weeklyBehavior, setWeeklyBehavior] = useState(goal?.weeklyBehavior ?? "");
  const [obstacle, setObstacle] = useState(goal?.obstacle ?? "");
  const [ifThen1Trigger, setIfThen1Trigger] = useState(goal?.ifThen1Trigger ?? "");
  const [ifThen1Action, setIfThen1Action] = useState(goal?.ifThen1Action ?? "");
  const [ifThen2Trigger, setIfThen2Trigger] = useState(goal?.ifThen2Trigger ?? "");
  const [ifThen2Action, setIfThen2Action] = useState(goal?.ifThen2Action ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
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
          successMetric: successMetric.trim(),
          identityStatement: identityStatement.trim(),
          observableProof: observableProof.trim(),
          weeklyBehavior: weeklyBehavior.trim(),
          obstacle: obstacle.trim(),
          ifThen1Trigger: ifThen1Trigger.trim(),
          ifThen1Action: ifThen1Action.trim(),
          ifThen2Trigger: ifThen2Trigger.trim(),
          ifThen2Action: ifThen2Action.trim(),
          description: description.trim(),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
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
      {withVisualization && (
        <div className="space-y-3">
          <GuidedVisualization steps={FUTURE_SCENE} endText={FUTURE_END} />
          <GuidedVisualization steps={OBSTACLE_SCENE} endText={OBSTACLE_END} />
          <p className="text-[12px] leading-[1.4] text-ink-soft">
            Reflect, then refine the answers below. Saving updates the goal only —
            your weekly habit on Systems is untouched.
          </p>
        </div>
      )}

      <div>
        <Label>Goal — in three words</Label>
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
        <Label>Area</Label>
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
        <Label>Success metric</Label>
        <TextArea
          value={successMetric}
          onChange={setSuccessMetric}
          placeholder="Number or description of done."
          rows={2}
          maxLength={150}
          ariaLabel="Success metric"
        />
      </div>

      <div>
        <Label>In 12 months, you are the kind of person who…</Label>
        <TextArea
          value={identityStatement}
          onChange={setIdentityStatement}
          rows={2}
          maxLength={200}
          ariaLabel="The kind of person you are in 12 months"
        />
      </div>

      <div>
        <Label>Observable proof</Label>
        <TextArea
          value={observableProof}
          onChange={setObservableProof}
          rows={2}
          maxLength={200}
          ariaLabel="Observable proof"
        />
      </div>

      <div>
        <Label>Weekly proof behavior</Label>
        <input
          type="text"
          value={weeklyBehavior}
          onChange={(e) => setWeeklyBehavior(e.target.value)}
          maxLength={80}
          aria-label="Weekly proof behavior"
          className={cn(inputClass, "h-12 text-[16px]")}
        />
        <p className="mt-1 text-[11.5px] leading-[1.4] text-ink-soft">
          Editing this text does not change your weekly habit — manage that on
          Systems.
        </p>
      </div>

      <div>
        <Label>Obstacle</Label>
        <TextArea
          value={obstacle}
          onChange={setObstacle}
          rows={2}
          maxLength={200}
          ariaLabel="The obstacle"
        />
      </div>

      <div>
        <Label>If–then plan 1</Label>
        <IfThenFields
          n={1}
          trigger={ifThen1Trigger}
          action={ifThen1Action}
          onTrigger={setIfThen1Trigger}
          onAction={setIfThen1Action}
        />
      </div>
      <div>
        <Label>If–then plan 2</Label>
        <IfThenFields
          n={2}
          trigger={ifThen2Trigger}
          action={ifThen2Action}
          onTrigger={setIfThen2Trigger}
          onAction={setIfThen2Action}
        />
      </div>

      <div>
        <Label>Why it matters · optional</Label>
        <TextArea
          value={description}
          onChange={setDescription}
          placeholder="What this unlocks, in your words…"
          rows={2}
          maxLength={300}
          ariaLabel="Why this goal matters"
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
        <button
          type="button"
          onClick={onDone}
          className="rounded-pill border border-hairline px-4 text-[13px] font-semibold text-ink-soft transition active:scale-95"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

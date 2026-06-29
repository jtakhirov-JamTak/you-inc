"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn, safeUUID, formatDollars, formatSignedDollars } from "@/lib/utils";
import { TextArea } from "@/components/ui/text-area";
import { pillAccentClass, SecondaryButton } from "@/components/ui/button";
import {
  GuidedVisualization,
  type VizStep,
} from "@/components/ui/guided-visualization";
import narration from "@/lib/narration.json";
import { Label, IfThenFields } from "./goal-shared";
import { buildSprintGrid } from "@/lib/price/engine";
import type { SprintSize } from "@/lib/price/config";

// The guided sprint-creation flow (founder spec): Domain → Future Scene →
// Behavior → Obstacle. Full-screen modal takeover; the persisted answers (size,
// area, thesis, term, tasks) live in client state and commit ONCE at the end to
// POST /api/sprints. The visualizations + their reflection boxes / if-then plans
// are IN-FLOW GUIDANCE ONLY — they are never sent or stored.

type Area = "health" | "wealth" | "relationships";
const AREAS: Area[] = ["health", "wealth", "relationships"];
const AREA_LABEL: Record<Area, string> = {
  health: "Health",
  wealth: "Wealth",
  relationships: "Relationships",
};
const SIZES: SprintSize[] = ["small", "medium", "big"];
const SIZE_LABEL: Record<SprintSize, string> = {
  small: "Small",
  medium: "Medium",
  big: "Big",
};
const TERMS = [10, 11, 12, 13, 14] as const;

// Visualization scripts — text + silence + narration clip id — come from the
// shared narration.json (the same file scripts/generate-narration.mjs renders to
// audio), so the on-screen prompts and the spoken clips can never drift. Module
// constants → stable references for GuidedVisualization's by-index controller.
const toSteps = (s: (typeof narration.sprintFuture.steps)[number][]): VizStep[] =>
  s.map((x) => ({ text: x.text, holdMs: x.holdMs, audio: x.id }));

const FUTURE_SCENE: VizStep[] = toSteps(narration.sprintFuture.steps);
const FUTURE_END = narration.sprintFuture.endText;
const FUTURE_END_AUDIO = narration.sprintFuture.endId;

const OBSTACLE_SCENE: VizStep[] = toSteps(narration.sprintObstacle.steps);
const OBSTACLE_END = narration.sprintObstacle.endText;
const OBSTACLE_END_AUDIO = narration.sprintObstacle.endId;

export function SprintFlow({
  basisCents,
  hasActive,
  onClose,
}: {
  basisCents: number;
  hasActive: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [step, setStep] = useState(1);

  // Step 1 — Domain (persisted)
  const [area, setArea] = useState<Area>("health");
  const [size, setSize] = useState<SprintSize>("medium");
  const [thesis, setThesis] = useState("");

  // Step 2 — Future Scene (in-flow guidance only — NOT persisted)
  const [futureDone, setFutureDone] = useState(false);
  const [futureReflect1, setFutureReflect1] = useState("");
  const [futureReflect2, setFutureReflect2] = useState("");

  // Step 3 — Behavior (persisted): term + task checklist
  const [term, setTerm] = useState<(typeof TERMS)[number]>(12);
  // Each draft carries a stable id so add/remove keys by identity, not index.
  const [tasks, setTasks] = useState<{ id: string; title: string; dueDay: number }[]>(() => [
    { id: safeUUID(), title: "", dueDay: 12 },
    { id: safeUUID(), title: "", dueDay: 12 },
    { id: safeUUID(), title: "", dueDay: 12 },
  ]);

  // Step 4 — Obstacle (in-flow guidance only — NOT persisted)
  const [obstacleDone, setObstacleDone] = useState(false);
  const [obstacle, setObstacle] = useState("");
  const [ifThen1Trigger, setIfThen1Trigger] = useState("");
  const [ifThen1Action, setIfThen1Action] = useState("");
  const [ifThen2Trigger, setIfThen2Trigger] = useState("");
  const [ifThen2Action, setIfThen2Action] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hide the app chrome (tab bar / top bar) while the flow owns the screen.
  useEffect(() => {
    document.body.classList.add("flow-open");
    return () => document.body.classList.remove("flow-open");
  }, []);

  // Move focus to the step heading on each step change (a11y for the takeover).
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  // Modal keyboard behavior: Escape closes; Tab is trapped inside the dialog.
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = node!.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !node!.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !node!.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
    node.addEventListener("keydown", onKeyDown);
    return () => node.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const cleanTasks = tasks
    .filter((t) => t.title.trim())
    .map((t) => ({ title: t.title.trim(), dueDay: Math.min(t.dueDay, term) }));

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
    setTasks((prev) => (prev.length >= 12 ? prev : [...prev, { id: safeUUID(), title: "", dueDay: term }]));
  }
  function removeTask(i: number) {
    setTasks((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }
  // Keep every milestone within the term when the term shrinks.
  function changeTerm(t: (typeof TERMS)[number]) {
    setTerm(t);
    setTasks((prev) => prev.map((task) => (task.dueDay > t ? { ...task, dueDay: t } : task)));
  }

  const step1Valid = thesis.trim().length > 0;
  const step2Valid = futureDone;
  const step3Valid = cleanTasks.length > 0;
  const step4Valid = obstacleDone;

  async function submit() {
    if (!step1Valid || !step3Valid || saving) return;
    setSaving(true);
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
      router.refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  const TITLES = ["Domain", "Future scene", "Behavior", "Obstacle"] as const;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Start a sprint"
      className="fixed inset-0 z-50 overflow-y-auto bg-background"
    >
      <div className="mx-auto flex min-h-full max-w-[460px] flex-col px-[18px] pt-[max(1rem,env(safe-area-inset-top))]">
        {/* Header — progress + exit */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-soft">
            {hasActive ? "Queue a sprint" : "New sprint"} · Step {step} of 4
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-pill px-3 text-[12px] font-semibold text-ink-soft transition active:scale-95"
          >
            Close
          </button>
        </div>

        <h1
          ref={headingRef}
          tabIndex={-1}
          className="mt-2 font-display text-[24px] font-extrabold leading-none tracking-[-0.02em] text-ink outline-none"
        >
          {TITLES[step - 1]}
        </h1>

        <div className="mt-5 flex-1">
          {step === 1 && (
            <div className="space-y-5">
              <p className="text-[15px] leading-[1.5] text-ink">
                A 10–14 day push. Pick the domain it invests in, how big a bet it
                is, and the thesis you&apos;re testing.
              </p>

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
                          "min-h-12 flex-1 rounded-card-sm border px-2 text-[13px] font-semibold transition active:scale-95",
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
                <Label>Size</Label>
                <div className="flex gap-2">
                  {SIZES.map((sz) => {
                    const selected = size === sz;
                    return (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => setSize(sz)}
                        aria-pressed={selected}
                        className={cn(
                          "min-h-12 flex-1 rounded-card-sm border px-2 text-[13px] font-semibold transition active:scale-95",
                          selected
                            ? "border-accent bg-accent text-accent-text"
                            : "border-divider bg-surface text-ink-soft",
                        )}
                      >
                        {SIZE_LABEL[sz]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <Label>Thesis</Label>
                <TextArea
                  value={thesis}
                  onChange={setThesis}
                  placeholder="If I do X over the next two weeks, Y becomes real."
                  rows={2}
                  maxLength={280}
                  ariaLabel="Sprint thesis"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {!futureDone ? (
                <GuidedVisualization
                  steps={FUTURE_SCENE}
                  endText={FUTURE_END}
                  endAudio={FUTURE_END_AUDIO}
                  onComplete={() => setFutureDone(true)}
                />
              ) : (
                <div className="space-y-4">
                  <p className="text-[13px] font-semibold text-ink-soft">
                    {FUTURE_END}
                  </p>
                  <p className="text-[12px] leading-[1.4] text-ink-soft">
                    These notes are just for you to think — they aren&apos;t saved.
                  </p>
                  <div>
                    <Label>The one task that mattered most was…</Label>
                    <TextArea
                      value={futureReflect1}
                      onChange={setFutureReflect1}
                      placeholder="What you most wanted done by the last day."
                      rows={2}
                      maxLength={200}
                      ariaLabel="The task that mattered most"
                    />
                  </div>
                  <div>
                    <Label>What someone else would notice is…</Label>
                    <TextArea
                      value={futureReflect2}
                      onChange={setFutureReflect2}
                      placeholder="The observable proof of the win."
                      rows={2}
                      maxLength={200}
                      ariaLabel="Observable proof"
                    />
                  </div>
                  <ReplayButton onClick={() => setFutureDone(false)} />
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              {/* Term — set before tasks so the milestone day pickers know their range. */}
              <div>
                <Label>Term</Label>
                <div className="flex gap-2">
                  {TERMS.map((t) => {
                    const on = term === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={on}
                        onClick={() => changeTerm(t)}
                        className={cn(
                          "min-h-11 flex-1 rounded-pill border text-[13px] font-semibold transition active:scale-95",
                          on
                            ? "border-transparent bg-accent text-accent-text"
                            : "border-hairline bg-surface text-ink-soft",
                        )}
                      >
                        {t}d
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tasks — each carries a milestone day; a missed milestone is what
                  books a negative on the live unrealized return (not before its day). */}
              <div>
                <Label>Tasks · set each milestone day</Label>
                <div className="mt-1.5 space-y-1.5">
                  {tasks.map((t, i) => (
                    <div key={t.id} className="flex items-center gap-2">
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
              <div className="rounded-card-sm border border-gold-border bg-gold-bg p-3">
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-gold-label">
                  Locked at today&apos;s {formatDollars(basisCents)}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[11px] text-ink-soft">Complete this →</div>
                    <div className="font-mono text-[15px] font-semibold tabular-nums text-positive">
                      {formatSignedDollars(grid.bestCents)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-ink-soft">Miss entirely →</div>
                    <div className="font-mono text-[15px] font-semibold tabular-nums text-danger">
                      {formatSignedDollars(grid.worstCents)}
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-[11px] leading-snug text-ink-soft">
                  Books to your operating value only at close. Partial completion
                  lands on the grid in between.
                </p>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              {!obstacleDone ? (
                <GuidedVisualization
                  steps={OBSTACLE_SCENE}
                  endText={OBSTACLE_END}
                  endAudio={OBSTACLE_END_AUDIO}
                  onComplete={() => setObstacleDone(true)}
                />
              ) : (
                <div className="space-y-4">
                  <p className="text-[12px] leading-[1.4] text-ink-soft">
                    A plan for the moment it gets hard — just for you, not saved.
                  </p>
                  <div>
                    <Label>Write the obstacle in one sentence</Label>
                    <TextArea
                      value={obstacle}
                      onChange={setObstacle}
                      placeholder="The main thing inside me that could derail this is…"
                      rows={2}
                      maxLength={200}
                      ariaLabel="The obstacle"
                    />
                  </div>

                  <Label>Two if–then plans</Label>
                  <IfThenFields
                    n={1}
                    trigger={ifThen1Trigger}
                    action={ifThen1Action}
                    onTrigger={setIfThen1Trigger}
                    onAction={setIfThen1Action}
                  />
                  <IfThenFields
                    n={2}
                    trigger={ifThen2Trigger}
                    action={ifThen2Action}
                    onTrigger={setIfThen2Trigger}
                    onAction={setIfThen2Action}
                  />
                  <ReplayButton onClick={() => setObstacleDone(false)} />
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 text-[13px] font-medium text-danger">
            {error}
          </p>
        )}

        {/* Footer — sticky so it (and the inputs above it) stay reachable over the
            soft keyboard; safe-area padding clears the home indicator. */}
        <div className="sticky bottom-0 -mx-[18px] mt-6 flex gap-2 border-t border-hairline bg-background px-[18px] pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          {step > 1 && (
            <SecondaryButton className="px-5" onClick={() => setStep(step - 1)}>
              Back
            </SecondaryButton>
          )}
          {step < 4 ? (
            <button
              type="button"
              disabled={
                (step === 1 && !step1Valid) ||
                (step === 2 && !step2Valid) ||
                (step === 3 && !step3Valid)
              }
              onClick={() => setStep(step + 1)}
              className={cn(pillAccentClass, "h-12 flex-1 text-[14px]")}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              disabled={!step1Valid || !step3Valid || !step4Valid || saving}
              onClick={submit}
              className={cn(pillAccentClass, "h-12 flex-1 text-[14px]")}
            >
              {saving ? "Starting…" : hasActive ? "Queue sprint" : "Start sprint"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ReplayButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[6px] border border-hairline px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-soft transition active:scale-95"
    >
      Replay visualization
    </button>
  );
}

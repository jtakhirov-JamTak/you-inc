"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { inputClass } from "@/components/ui/field";
import { TextArea } from "@/components/ui/text-area";
import { pillAccentClass, SecondaryButton } from "@/components/ui/button";
import {
  GuidedVisualization,
  type VizStep,
} from "@/components/ui/guided-visualization";
import { Label, IfThenFields } from "./goal-shared";
import { WEEKDAYS, WEEKDAY_NAMES, TERMS } from "../habits/habit-roster-shared";

// The guided one-year-goal flow (founder spec): Domain → Future Scene → Weekly
// Habit → Obstacle. Full-screen modal takeover; all answers live in client state
// and commit ONCE at the end to POST /api/year-goals/flow, which saves the goal
// AND creates/replaces the weekly habit. Launched only when no goal exists yet
// (the first-time path); editing an existing goal uses the plain quick-edit form.

type Area = "health" | "wealth" | "relationships";
const AREAS: Area[] = ["health", "wealth", "relationships"];
const AREA_LABEL: Record<Area, string> = {
  health: "Health",
  wealth: "Wealth",
  relationships: "Relationships",
};

// Future-scene script — line then quiet (silence is AFTER the line is shown).
// Exported so the quick-edit "re-do visualization" replay reuses the same scripts.
export const FUTURE_SCENE: VizStep[] = [
  {
    text: "Close your eyes. It is exactly one year from today. This is not a fantasy. This is your realistic best-case outcome if you consistently did the work.",
    holdMs: 10_000,
  },
  {
    text: "Morning: What do you now do automatically that used to require effort?",
    holdMs: 15_000,
  },
  {
    text: "Midday: A hard moment happens. How do you handle it differently than today?",
    holdMs: 15_000,
  },
  {
    text: "Evening: What did you follow through on today that the old you would have avoided?",
    holdMs: 15_000,
  },
  {
    text: "Freeze frame: What single moment best captures your transformation?",
    holdMs: 15_000,
  },
];
export const FUTURE_END = "Now open your eyes and fill out these boxes.";

export const OBSTACLE_SCENE: VizStep[] = [
  {
    text: "Now contrast that future with reality: What inside me is most likely to block it? Close your eyes and picture the exact moment it happens vividly.",
    holdMs: 10_000,
  },
  { text: "The thought that will tempt me is …", holdMs: 10_000 },
  { text: "The emotion that comes with it is …", holdMs: 10_000 },
  { text: "The behavior it usually triggers is …", holdMs: 10_000 },
];
export const OBSTACLE_END =
  "Now open your eyes and write the obstacle in one sentence.";

const CONFIDENCE_MIN = 8;

export function GoalFlow({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [step, setStep] = useState(1);

  // Step 1 — Domain
  const [area, setArea] = useState<Area | null>(null);
  const [title, setTitle] = useState("");

  // Step 2 — Future Scene
  const [futureDone, setFutureDone] = useState(false);
  const [identityStatement, setIdentityStatement] = useState("");
  const [observableProof, setObservableProof] = useState("");
  const [successMetric, setSuccessMetric] = useState("");

  // Step 3 — Weekly Habit
  const [weeklyBehavior, setWeeklyBehavior] = useState("");
  const [days, setDays] = useState<number[]>([]);
  const [termDays, setTermDays] = useState<(typeof TERMS)[number]>(7);
  const [confidence, setConfidence] = useState<number | null>(null);

  // Step 4 — Obstacle
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

  // Modal keyboard behavior: Escape closes; Tab is trapped inside the dialog so a
  // keyboard/SR user can't wander into the (visually-hidden) page behind it.
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

  function toggleDay(d: number) {
    setDays((cur) =>
      cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d],
    );
  }

  const step1Valid = !!area && title.trim().length > 0;
  const step2Valid =
    futureDone &&
    identityStatement.trim().length > 0 &&
    observableProof.trim().length > 0 &&
    successMetric.trim().length > 0;
  const step3Valid =
    weeklyBehavior.trim().length > 0 &&
    days.length > 0 &&
    confidence !== null &&
    confidence >= CONFIDENCE_MIN;
  const step4Valid =
    obstacleDone &&
    obstacle.trim().length > 0 &&
    ifThen1Trigger.trim().length > 0 &&
    ifThen1Action.trim().length > 0 &&
    ifThen2Trigger.trim().length > 0 &&
    ifThen2Action.trim().length > 0;

  async function submit() {
    if (!step1Valid || !step2Valid || !step3Valid || !step4Valid || saving)
      return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/year-goals/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          area,
          identityStatement: identityStatement.trim(),
          observableProof: observableProof.trim(),
          successMetric: successMetric.trim(),
          weeklyBehavior: weeklyBehavior.trim(),
          days,
          termDays,
          obstacle: obstacle.trim(),
          ifThen1Trigger: ifThen1Trigger.trim(),
          ifThen1Action: ifThen1Action.trim(),
          ifThen2Trigger: ifThen2Trigger.trim(),
          ifThen2Action: ifThen2Action.trim(),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error || "Could not save your goal.");
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const TITLES = ["Domain", "Future scene", "Weekly habit", "Obstacle"] as const;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Set your year goal"
      className="fixed inset-0 z-50 overflow-y-auto bg-background"
    >
      <div className="mx-auto flex min-h-full max-w-[460px] flex-col px-[18px] pt-[max(1rem,env(safe-area-inset-top))]">
        {/* Header — progress + exit */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-soft">
            Year goal · Step {step} of 4
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
                If you could create unmistakable improvement in only one domain
                over the next year, which one would it be?
              </p>
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
              <div>
                <Label>Name the goal — in three words</Label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={60}
                  placeholder="e.g. Run a marathon"
                  aria-label="Year goal"
                  className={cn(
                    inputClass,
                    "h-12 text-[16px] font-bold tracking-[-0.01em]",
                  )}
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
                  onComplete={() => setFutureDone(true)}
                />
              ) : (
                <div className="space-y-4">
                  <p className="text-[13px] font-semibold text-ink-soft">
                    {FUTURE_END}
                  </p>
                  <div>
                    <Label>In 12 months, you are the kind of person who…</Label>
                    <TextArea
                      value={identityStatement}
                      onChange={setIdentityStatement}
                      placeholder="…shows up before motivation does."
                      rows={2}
                      maxLength={200}
                      ariaLabel="The kind of person you are in 12 months"
                    />
                  </div>
                  <div>
                    <Label>The proof that others can observe will be…</Label>
                    <TextArea
                      value={observableProof}
                      onChange={setObservableProof}
                      placeholder="What someone else would notice."
                      rows={2}
                      maxLength={200}
                      ariaLabel="Observable proof"
                    />
                  </div>
                  <div>
                    <Label>The success metric is (number / description)…</Label>
                    <TextArea
                      value={successMetric}
                      onChange={setSuccessMetric}
                      placeholder="e.g. Finished a sub-4:30 marathon."
                      rows={2}
                      maxLength={150}
                      ariaLabel="Success metric"
                    />
                  </div>
                  <ReplayButton onClick={() => setFutureDone(false)} />
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div>
                <Label>One primary proof behavior I will do every week</Label>
                <input
                  type="text"
                  value={weeklyBehavior}
                  onChange={(e) => setWeeklyBehavior(e.target.value)}
                  maxLength={80}
                  placeholder="e.g. One long run every week"
                  aria-label="Weekly proof behavior"
                  className={cn(inputClass, "h-12 text-[16px]")}
                />
                <p className="mt-1.5 text-[12px] leading-[1.4] text-ink-soft">
                  This becomes your weekly habit on Systems — replacing your
                  current weekly habit if you have one.
                </p>
              </div>

              <div>
                <Label>Set the days</Label>
                <div className="flex gap-1.5">
                  {WEEKDAYS.map((w) => {
                    const on = days.includes(w.d);
                    return (
                      <button
                        key={w.d}
                        type="button"
                        aria-pressed={on}
                        aria-label={WEEKDAY_NAMES[w.d]}
                        onClick={() => toggleDay(w.d)}
                        className={cn(
                          "h-11 flex-1 rounded-[12px] border text-[13px] font-semibold transition active:scale-95",
                          on
                            ? "border-transparent bg-accent text-accent-text"
                            : "border-hairline bg-surface text-ink-soft",
                        )}
                      >
                        {w.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <Label>Review term</Label>
                <div className="flex gap-2">
                  {TERMS.map((t) => {
                    const on = termDays === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setTermDays(t)}
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

              <div>
                <Label>
                  How confident are you, 0–10, that you can sustain this for at
                  least 4 weeks?
                </Label>
                <div className="grid grid-cols-6 gap-1.5">
                  {Array.from({ length: 11 }, (_, n) => {
                    const on = confidence === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        aria-pressed={on}
                        aria-label={`Confidence ${n}`}
                        onClick={() => setConfidence(n)}
                        className={cn(
                          "min-h-11 rounded-[10px] border text-[14px] font-semibold transition active:scale-95",
                          on
                            ? "border-transparent bg-accent text-accent-text"
                            : "border-hairline bg-surface text-ink-soft",
                        )}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
                <p
                  aria-live="polite"
                  className="mt-2 min-h-[18px] text-[12px] leading-[1.4] text-ink-soft"
                >
                  {confidence !== null && confidence < CONFIDENCE_MIN
                    ? "Below 8 — reshape the behavior into something smaller you're sure you'll keep, then raise it to 8 or more."
                    : confidence !== null
                      ? "Strong enough to commit."
                      : ""}
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
                  onComplete={() => setObstacleDone(true)}
                />
              ) : (
                <div className="space-y-4">
                  <div>
                    <Label>Write the obstacle in one sentence</Label>
                    <TextArea
                      value={obstacle}
                      onChange={setObstacle}
                      placeholder="The main thing inside me that blocks this is…"
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
              disabled={!step4Valid || saving}
              onClick={submit}
              className={cn(pillAccentClass, "h-12 flex-1 text-[14px]")}
            >
              {saving ? "Saving…" : "Set the goal"}
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

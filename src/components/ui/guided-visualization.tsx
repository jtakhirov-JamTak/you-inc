"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { pillAccentClass } from "@/components/ui/button";

// A timed guided visualization: press Start, then each prompt is shown for its
// `holdMs` of quiet before the next appears, ending on `endText` ("Now open your
// eyes…"). `onComplete` fires once when the sequence finishes — the caller then
// reveals its input boxes. The script (lines + silences) is passed in by the
// caller so this stays a generic reflection primitive.
//
// Accessibility:
//  - A persistent visually-hidden aria-live region announces each prompt. It's
//    mounted for the component's whole life (not created with the first line),
//    so screen readers reliably announce line 1 (live regions don't announce
//    their initial contents).
//  - Timed content (WCAG 2.2.1): a "Reveal all" control is available to EVERY
//    user during the timed run — it switches to the all-at-once view with a
//    Continue button, so no one is gated purely by the timer.
//  - `prefers-reduced-motion: reduce` starts in that all-at-once view by default.

export type VizStep = { text: string; holdMs: number };

type Phase = "idle" | "running" | "done";

export function GuidedVisualization({
  steps,
  endText,
  startLabel = "Start",
  onComplete,
  className,
}: {
  // IMPORTANT: pass a STABLE reference (a module-level constant or a memoized
  // array). The timed-sequence effect keys on `steps` identity; a fresh array
  // literal each render would clear and restart the current line's timer.
  steps: VizStep[];
  endText: string;
  startLabel?: string;
  onComplete?: () => void;
  className?: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [index, setIndex] = useState(0);
  // `revealed` = the user (or reduced-motion) chose the all-at-once view.
  const [revealed, setRevealed] = useState(false);
  // Read prefers-reduced-motion lazily (false during SSR). It only affects the
  // "running" phase, never the idle first render, so there's no hydration drift.
  const [reduced, setReduced] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the latest onComplete without retriggering the sequence effect.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Subscribe to reduced-motion changes (setState only in the listener callback).
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const manual = reduced || revealed;

  // Drive the timed sequence: hold the current line, then either advance to the
  // next or settle to "done". The state change happens inside the timer callback
  // (never synchronously in the effect body), so each step renders for its hold.
  useEffect(() => {
    if (phase !== "running" || manual) return;
    const isLast = index >= steps.length - 1;
    timer.current = setTimeout(() => {
      if (isLast) {
        setPhase("done");
        onCompleteRef.current?.();
      } else {
        setIndex((i) => i + 1);
      }
    }, steps[index].holdMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [phase, index, steps, manual]);

  // Clean up any pending timer on unmount.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function start() {
    setIndex(0);
    setPhase("running");
  }

  function finishManually() {
    if (timer.current) clearTimeout(timer.current);
    setPhase("done");
    onCompleteRef.current?.();
  }

  // Persistent live region — announces the current prompt while running. Always
  // mounted so line 1 is announced (a region created with its content is silent).
  const liveRegion = (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {phase === "running" && !manual ? steps[Math.min(index, steps.length - 1)].text : ""}
    </p>
  );

  // ── Idle — the Start gate ───────────────────────────────────────────────────
  if (phase === "idle") {
    return (
      <div
        className={cn(
          "rounded-card border border-hairline bg-surface p-5 text-center",
          className,
        )}
      >
        {liveRegion}
        <p className="text-[13px] leading-[1.5] text-ink-soft">
          Find a still moment. This takes about{" "}
          {Math.round(steps.reduce((s, x) => s + x.holdMs, 0) / 1000)} seconds —
          read each line, then close your eyes.
        </p>
        <button
          type="button"
          onClick={start}
          className={cn(pillAccentClass, "mt-4 h-12 w-full text-[14px]")}
        >
          {startLabel}
        </button>
      </div>
    );
  }

  // ── Done — the "open your eyes" beat (caller reveals its inputs) ─────────────
  if (phase === "done") {
    return (
      <div
        className={cn(
          "rounded-card border border-hairline bg-surface px-5 py-4 text-center",
          className,
        )}
      >
        {liveRegion}
        <p className="text-[13px] font-semibold leading-[1.5] text-ink">
          {endText}
        </p>
      </div>
    );
  }

  // ── Running — all-at-once view (reduced-motion, or user pressed "Reveal all") ─
  if (manual) {
    return (
      <div
        className={cn(
          "space-y-3 rounded-card border border-hairline bg-surface p-5",
          className,
        )}
      >
        {liveRegion}
        <ul className="space-y-2.5">
          {steps.map((s, i) => (
            <li key={i} className="text-[14px] leading-[1.5] text-ink">
              {s.text}
            </li>
          ))}
        </ul>
        <p className="text-[13px] font-semibold text-ink-soft">{endText}</p>
        <button
          type="button"
          onClick={finishManually}
          className={cn(pillAccentClass, "h-12 w-full text-[14px]")}
        >
          Continue
        </button>
      </div>
    );
  }

  // ── Running — the timed reveal ──────────────────────────────────────────────
  const current = steps[Math.min(index, steps.length - 1)];
  return (
    <div
      className={cn(
        "flex min-h-[200px] flex-col items-center justify-center rounded-card border border-hairline bg-surface p-6 text-center",
        className,
      )}
    >
      {liveRegion}
      <p aria-hidden className="text-[17px] font-medium leading-[1.45] text-ink">
        {current.text}
      </p>
      <span
        aria-hidden
        className="mt-5 h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint"
      />
      <button
        type="button"
        onClick={() => setRevealed(true)}
        className="mt-5 rounded-pill px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft underline-offset-2 transition hover:underline active:scale-95"
      >
        Reveal all prompts
      </button>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { pillAccentClass } from "@/components/ui/button";

// A timed guided visualization: press Start, then each prompt is READ ALOUD from a
// pre-rendered narration clip and held for its `holdMs` of quiet so the user can
// picture it before the next line, ending on `endText` ("Now open your eyes…").
// `onComplete` fires once when the sequence finishes — the caller then reveals its
// input boxes. The script (lines + silences + clip ids) is passed in by the caller
// so this stays a generic reflection primitive.
//
// Audio:
//  - Each step may carry an `audio` id; the clip is served from `/audio/{id}.mp3`
//    (rendered offline by scripts/generate-narration.mjs). Playback is on by default
//    with a mute toggle (remembered in localStorage). If a clip is missing, blocked
//    by the browser, or muted, it falls back to the original silent timed reveal —
//    `holdMs` then drives the pacing on its own.
//  - `holdMs` is the visualization pause AFTER a line is read (or, when silent, the
//    time the line is shown).
//  - The first clip is played synchronously inside the Start click so iOS unlocks
//    audio for the rest of the sequence (programmatic play is otherwise blocked).
//
// Accessibility:
//  - A persistent visually-hidden aria-live region announces each prompt. It's
//    mounted for the component's whole life so screen readers reliably announce
//    line 1 (live regions don't announce their initial contents). Screen-reader
//    users can mute the narration.
//  - Timed content (WCAG 2.2.1): a "Reveal all" control is available to EVERY user
//    during the timed run — it switches to the all-at-once view with a Continue
//    button, so no one is gated purely by the timer.
//  - `prefers-reduced-motion: reduce` starts in that all-at-once view by default
//    (silent, no auto-advance — also avoids talking over a screen reader).

export type VizStep = { text: string; holdMs: number; audio?: string };

type Phase = "idle" | "running" | "done";

const SOUND_KEY = "viz-sound";
const clipSrc = (id?: string) => (id ? `/audio/${id}.mp3` : null);

export function GuidedVisualization({
  steps,
  endText,
  endAudio,
  startLabel = "Start",
  speak = true,
  onComplete,
  className,
}: {
  // IMPORTANT: pass a STABLE reference (a module-level constant or a memoized
  // array). The controller reads `steps` by index; a fresh array literal each
  // render is fine for rendering but the script should not change mid-run.
  steps: VizStep[];
  endText: string;
  // Clip id for the closing "open your eyes" line, played when the run completes.
  endAudio?: string;
  startLabel?: string;
  // Set false to keep this instance silent (timed reveal only). Default reads aloud.
  speak?: boolean;
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
  // Narration on/off, remembered across the two visualizations in one flow. Only an
  // explicit "0" disables it. This flow only mounts after a click (never SSR'd), so
  // reading localStorage in the initializer can't cause hydration drift.
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(SOUND_KEY) !== "0";
    } catch {
      return true;
    }
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which index the hold timer is already scheduled for — dedupes the several events
  // that can each request it (ended / error / play-rejection / safety).
  const holdForRef = useRef<number>(-1);
  // True only while the timed sequence is live (guards stale async callbacks).
  const runningRef = useRef(false);
  // Mirror of soundOn for the async playback callbacks (avoids stale closures).
  const soundOnRef = useRef(soundOn);
  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);
  // Keep the latest onComplete without threading it through the controller.
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
  const hasNarration = speak && steps.some((s) => !!s.audio);

  function clearTimers() {
    if (holdRef.current) {
      clearTimeout(holdRef.current);
      holdRef.current = null;
    }
    if (safetyRef.current) {
      clearTimeout(safetyRef.current);
      safetyRef.current = null;
    }
  }

  function stopAudio() {
    const a = audioRef.current;
    if (!a) return;
    a.onended = null;
    a.onerror = null;
    a.pause();
  }

  // Schedule the visualization pause after a line, then advance / finish. Dedupes so
  // the clip's `ended`, an error, and the safety timer can't each start a new hold.
  function scheduleHold(i: number) {
    if (holdForRef.current === i) return;
    holdForRef.current = i;
    if (safetyRef.current) {
      clearTimeout(safetyRef.current);
      safetyRef.current = null;
    }
    stopAudio();
    holdRef.current = setTimeout(() => {
      if (!runningRef.current) return;
      if (i >= steps.length - 1) {
        finishTimed();
      } else {
        playFrom(i + 1);
      }
    }, steps[i].holdMs);
  }

  // Show line `i`, read its clip if narration is on, then hold. Falls back to a plain
  // hold if there's no clip, narration is muted, or the browser blocks playback.
  function playFrom(i: number) {
    if (!runningRef.current) return;
    setIndex(i);
    holdForRef.current = -1;
    const a = audioRef.current;
    const src = clipSrc(steps[i].audio);
    if (speak && soundOnRef.current && a && src) {
      a.onended = () => scheduleHold(i);
      a.onerror = () => scheduleHold(i);
      a.src = src;
      a.currentTime = 0;
      const p = a.play();
      if (p && typeof p.then === "function") p.catch(() => scheduleHold(i));
      // Backstop: if no event fires (rare browser bug), advance on an upper bound.
      safetyRef.current = setTimeout(() => scheduleHold(i), 60_000);
    } else {
      scheduleHold(i);
    }
  }

  function finishTimed() {
    runningRef.current = false;
    clearTimers();
    setPhase("done");
    onCompleteRef.current?.();
    // Read the closing line (best-effort; element is already unlocked by Start).
    const a = audioRef.current;
    const src = clipSrc(endAudio);
    if (speak && soundOnRef.current && a && src) {
      a.onended = null;
      a.onerror = null;
      a.src = src;
      a.currentTime = 0;
      a.play()?.catch(() => {});
    }
  }

  function start() {
    runningRef.current = true;
    setPhase("running");
    playFrom(0); // synchronous within the click → iOS unlocks audio for the run
  }

  function finishManually() {
    runningRef.current = false;
    clearTimers();
    stopAudio();
    setPhase("done");
    onCompleteRef.current?.();
  }

  function revealAll() {
    runningRef.current = false;
    clearTimers();
    stopAudio();
    setRevealed(true);
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    soundOnRef.current = next;
    try {
      window.localStorage.setItem(SOUND_KEY, next ? "1" : "0");
    } catch {
      /* preference is non-critical */
    }
    if (phase !== "running" || manual) {
      if (!next) stopAudio();
      return;
    }
    if (next) {
      // Unmute mid-run: replay the current line (this click also re-unlocks audio).
      clearTimers();
      holdForRef.current = -1;
      playFrom(index);
    } else {
      // Mute mid-run: stop the clip and ensure the line still advances on its hold.
      stopAudio();
      scheduleHold(index);
    }
  }

  // One reusable audio element for the component's life; tear everything down on
  // unmount (declared after the controller so the cleanup can reference it).
  useEffect(() => {
    if (typeof Audio !== "undefined") audioRef.current = new Audio();
    return () => {
      runningRef.current = false;
      clearTimers();
      stopAudio();
      audioRef.current = null;
    };
  }, []);

  // Persistent live region — announces the current prompt while running. Always
  // mounted so line 1 is announced (a region created with its content is silent).
  const liveRegion = (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {phase === "running" && !manual ? steps[Math.min(index, steps.length - 1)].text : ""}
    </p>
  );

  const soundToggle = hasNarration ? (
    <button
      type="button"
      onClick={toggleSound}
      aria-pressed={soundOn}
      aria-label={soundOn ? "Mute narration" : "Unmute narration"}
      className="inline-flex h-11 items-center gap-1.5 rounded-pill px-3 text-ink-soft transition hover:text-ink active:scale-95"
    >
      {soundOn ? (
        <Volume2 className="h-4 w-4" aria-hidden />
      ) : (
        <VolumeX className="h-4 w-4" aria-hidden />
      )}
      <span className="font-mono text-[10px] uppercase tracking-[0.12em]">
        {soundOn ? "Sound on" : "Muted"}
      </span>
    </button>
  ) : null;

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
          {hasNarration
            ? "Find a still moment. Each line is read aloud, then held in silence — picture it, eyes open or closed."
            : "Find a still moment. Read each line, then close your eyes and picture it."}
        </p>
        <button
          type="button"
          onClick={start}
          className={cn(pillAccentClass, "mt-4 h-12 w-full text-[14px]")}
        >
          {startLabel}
        </button>
        {soundToggle && <div className="mt-3 flex justify-center">{soundToggle}</div>}
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
      {soundToggle && <div className="mt-4 flex justify-center">{soundToggle}</div>}
      <button
        type="button"
        onClick={revealAll}
        className="mt-2 rounded-pill px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft underline-offset-2 transition hover:underline active:scale-95"
      >
        Reveal all prompts
      </button>
    </div>
  );
}

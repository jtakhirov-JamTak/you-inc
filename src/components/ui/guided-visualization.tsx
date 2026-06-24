"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { pillAccentClass } from "@/components/ui/button";
import { isSpeechAvailable, pickVoice } from "@/lib/speech";

// A timed guided visualization: press Start, then each prompt is READ ALOUD (device
// text-to-speech) and held for its `holdMs` of quiet so the user can picture it
// before the next appears, ending on `endText` ("Now open your eyes…"). `onComplete`
// fires once when the sequence finishes — the caller then reveals its input boxes.
// The script (lines + silences) is passed in by the caller so this stays a generic
// reflection primitive.
//
// Audio:
//  - Uses the browser's Web Speech API (`speechSynthesis`). On by default with a
//    mute toggle (remembered in localStorage). When muted or unsupported it falls
//    back to the original silent timed reveal — `holdMs` then drives the pacing.
//  - `holdMs` is the visualization pause AFTER a line is spoken (or, when silent,
//    the time the line is shown).
//
// Accessibility:
//  - A persistent visually-hidden aria-live region announces each prompt. It's
//    mounted for the component's whole life (not created with the first line),
//    so screen readers reliably announce line 1 (live regions don't announce
//    their initial contents). Screen-reader users can mute the device narration.
//  - Timed content (WCAG 2.2.1): a "Reveal all" control is available to EVERY
//    user during the timed run — it switches to the all-at-once view with a
//    Continue button, so no one is gated purely by the timer.
//  - `prefers-reduced-motion: reduce` starts in that all-at-once view by default
//    (silent, no auto-advance — also avoids talking over a screen reader).

export type VizStep = { text: string; holdMs: number };

type Phase = "idle" | "running" | "done";

const SOUND_KEY = "viz-sound";

export function GuidedVisualization({
  steps,
  endText,
  startLabel = "Start",
  speak = true,
  onComplete,
  className,
}: {
  // IMPORTANT: pass a STABLE reference (a module-level constant or a memoized
  // array). The timed-sequence effect keys on `steps` identity; a fresh array
  // literal each render would clear and restart the current line's timer.
  steps: VizStep[];
  endText: string;
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
  // Resolved lazily on the client. This flow only ever mounts after a click (a
  // modal takeover, never server-rendered), so — like `reduced` above — there's no
  // hydration drift from reading a browser capability here.
  const [speechSupported] = useState<boolean>(() => isSpeechAvailable());
  // Narration on/off, remembered across the two visualizations in one flow. Only an
  // explicit "0" disables it; not rendered until `speechSupported` so it can't drift.
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(SOUND_KEY) !== "0";
    } catch {
      return true;
    }
  });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
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

  // Pick the nicest English voice once the platform's voice list is ready (it can
  // load asynchronously). Falls back to the platform default if none is chosen.
  useEffect(() => {
    if (!speechSupported) return;
    const synth = window.speechSynthesis;
    const load = () => {
      const v = pickVoice(synth.getVoices());
      if (v) voiceRef.current = v;
    };
    load();
    synth.addEventListener?.("voiceschanged", load);
    return () => synth.removeEventListener?.("voiceschanged", load);
  }, [speechSupported]);

  const manual = reduced || revealed;
  const speechOn = speak && soundOn && speechSupported;

  function buildUtterance(text: string) {
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.92; // a touch slow for a calm, guided cadence
    utter.lang = "en-US";
    if (voiceRef.current) utter.voice = voiceRef.current;
    return utter;
  }

  // Drive the timed sequence. With narration on: speak the line, then start its
  // `holdMs` pause once speech ends, then advance. Muted/unsupported: just hold for
  // `holdMs` (the original behavior). The state change happens inside a callback
  // (never synchronously in the effect body), so each step renders for its hold.
  useEffect(() => {
    if (phase !== "running" || manual) return;
    const step = steps[index];
    const isLast = index >= steps.length - 1;
    let safety: ReturnType<typeof setTimeout> | null = null;
    let advanced = false;

    const advance = () => {
      if (advanced) return;
      advanced = true;
      if (isLast) {
        setPhase("done");
        onCompleteRef.current?.();
      } else {
        setIndex((i) => i + 1);
      }
    };

    const startHold = () => {
      if (timer.current) return; // already holding (onend + safety can't double-fire)
      timer.current = setTimeout(advance, step.holdMs);
    };

    if (speechOn) {
      const synth = window.speechSynthesis;
      synth.cancel();
      const utter = buildUtterance(step.text);
      utter.onend = startHold;
      utter.onerror = startHold; // speech failed — still hold, then advance
      // Safety net: if `onend` never fires (a known browser bug), force the hold to
      // start anyway. Generous upper bound so it doesn't truncate real speech.
      const estimateMs = Math.min(60_000, 2_000 + step.text.length * 130);
      safety = setTimeout(() => {
        synth.cancel();
        startHold();
      }, estimateMs);
      synth.speak(utter);
    } else {
      startHold();
    }

    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (safety) clearTimeout(safety);
      if (isSpeechAvailable()) window.speechSynthesis.cancel();
    };
    // `speechOn` captures speak/soundOn/speechSupported; `steps` is a stable ref.
  }, [phase, index, manual, speechOn, steps]);

  // Speak the closing line when the sequence settles to "done".
  useEffect(() => {
    if (phase !== "done" || !speechOn) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    synth.speak(buildUtterance(endText));
    return () => synth.cancel();
  }, [phase, speechOn, endText]);

  // Cancel any in-flight speech on unmount.
  useEffect(() => {
    return () => {
      if (isSpeechAvailable()) window.speechSynthesis.cancel();
    };
  }, []);

  // iOS requires audio to be unlocked by a user gesture: speak a silent utterance
  // inside the click handler so the later effect-driven narration is allowed.
  function primeSpeech() {
    if (!speechOn) return;
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      synth.resume();
      const warm = buildUtterance(" ");
      warm.volume = 0;
      synth.speak(warm);
    } catch {
      /* unlock is best-effort */
    }
  }

  function start() {
    primeSpeech();
    setIndex(0);
    setPhase("running");
  }

  function finishManually() {
    if (timer.current) clearTimeout(timer.current);
    if (isSpeechAvailable()) window.speechSynthesis.cancel();
    setPhase("done");
    onCompleteRef.current?.();
  }

  function revealAll() {
    if (isSpeechAvailable()) window.speechSynthesis.cancel();
    setRevealed(true);
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    try {
      window.localStorage.setItem(SOUND_KEY, next ? "1" : "0");
    } catch {
      /* preference is non-critical */
    }
    if (!speechSupported || !speak) return;
    const synth = window.speechSynthesis;
    if (next) {
      primeSpeech(); // unlock + let the in-progress line pick up narration
    } else {
      synth.cancel();
    }
  }

  // Persistent live region — announces the current prompt while running. Always
  // mounted so line 1 is announced (a region created with its content is silent).
  const liveRegion = (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {phase === "running" && !manual ? steps[Math.min(index, steps.length - 1)].text : ""}
    </p>
  );

  const soundToggle = speechSupported && speak ? (
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
          {speechSupported
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

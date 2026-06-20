"use client";

import { useEffect, useRef, useState } from "react";
import { pickMimeType, measureRms, MIN_RMS_FOR_SPEECH } from "@/lib/audio";
import { VoiceWave } from "@/components/ui/voice-wave";

type Props = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  /**
   * Fill the parent's available height (textarea grows to fit) instead of a
   * fixed `rows` height. Used inside the no-scroll FlowScreen so the input
   * region fills the gap.
   */
  fill?: boolean;
  /**
   * Optional character cap. When set, applied to the textarea AND shown as the
   * counter denominator ("72 / 240"). Omit to leave input length unconstrained
   * (counter shows the plain count) — do not invent a cap that the server's
   * Zod schema doesn't enforce.
   */
  maxLength?: number;
  /**
   * Accessible name for the textarea. There is no visible <label> wired to this
   * control, so a screen reader would otherwise announce it as "blank". Pass a
   * distinct name at every call site (e.g. "Affirmation statement").
   */
  ariaLabel?: string;
};

type Status = "idle" | "recording" | "transcribing" | "error";

const MAX_RECORDING_SECONDS = 45;

export function VoiceInput({
  value,
  onChange,
  placeholder,
  rows = 4,
  disabled,
  fill,
  maxLength,
  ariaLabel,
}: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(MAX_RECORDING_SECONDS);
  const [hasRedo, setHasRedo] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  // Snapshot of the field value immediately before the most recent voice
  // commit. On Redo we restore exactly this — no diffing/splicing. If the
  // user typed after commit, restoring the snapshot is the correct behavior
  // for "undo last voice chunk."
  const redoSnapshotRef = useRef<string | null>(null);

  // Fresh value + onChange refs so async callbacks never close over stale state.
  // Without these, a transcript returning after the parent re-renders would
  // overwrite whatever the user typed in the meantime.
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      abortRef.current?.abort();
      const r = recorderRef.current;
      if (r && r.state !== "inactive") {
        try {
          r.stop();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  function clearTimer() {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function safeSetStatus(next: Status) {
    if (mountedRef.current) setStatus(next);
  }
  function safeSetError(next: string | null) {
    if (mountedRef.current) setError(next);
  }

  async function startRecording() {
    safeSetError(null);
    // Drop the soft keyboard before recording. In the no-scroll FlowScreen the
    // record button + "Recording…" indicator sit BELOW the textarea; an open
    // keyboard shrinks the viewport and clips them out of view, so the user
    // can't tell recording is live. Blurring restores the full band. (Redo
    // already starts recording without focusing, for the same reason.)
    textareaRef.current?.blur();
    // Defensive: abort any still-in-flight transcribe from a previous cycle
    // before we overwrite recorder/stream refs. Redo only renders on idle,
    // but state-machine changes elsewhere could let a recording start while
    // a prior fetch is still racing.
    abortRef.current?.abort();
    abortRef.current = null;
    // New recording invalidates any prior redo buffer. It will re-arm only
    // on the next successful voice commit.
    redoSnapshotRef.current = null;
    if (mountedRef.current) setHasRedo(false);
    const mimeType = pickMimeType();
    if (!mimeType) {
      safeSetStatus("error");
      safeSetError("Voice input isn't supported in this browser. Please type instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, { mimeType });
      } catch {
        recorder = new MediaRecorder(stream);
      }
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        void sendBlob(blob);
      };

      recorder.start();
      startedAtRef.current = Date.now();
      setSecondsLeft(MAX_RECORDING_SECONDS);

      // Wall-clock timer — immune to iOS background throttling.
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        const remaining = Math.max(0, MAX_RECORDING_SECONDS - elapsed);
        if (mountedRef.current) setSecondsLeft(remaining);
        if (remaining <= 0) {
          clearTimer();
          // Auto-stop: no error, just transcribe what we have.
          const r = recorderRef.current;
          if (r && r.state !== "inactive") {
            if (mountedRef.current) setStatus("transcribing");
            try { r.stop(); } catch { /* ignore */ }
          }
        }
      }, 500);

      safeSetStatus("recording");
    } catch (err) {
      console.error("mic access failed", (err as Error)?.name);
      safeSetStatus("error");
      safeSetError(
        "Microphone blocked. Enable mic access in your browser settings."
      );
    }
  }

  function stopRecording() {
    clearTimer();
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      safeSetStatus("transcribing");
      try {
        r.stop();
      } catch {
        safeSetStatus("error");
        safeSetError("Recording ended unexpectedly. Try again.");
      }
    }
  }

  async function sendBlob(blob: Blob) {
    // Client-side silence gate: skip Whisper entirely on empty audio.
    // Whisper returns hallucinated filler on silence; rejecting here avoids
    // polluting the textbox AND saves one API call per empty submission.
    // If decoding fails (measureRms returns null), send anyway and let the
    // server decide — a decode failure on our side doesn't mean bad audio.
    const rms = await measureRms(blob);
    if (rms !== null && rms < MIN_RMS_FOR_SPEECH) {
      if (!mountedRef.current) return;
      safeSetStatus("error");
      safeSetError("We didn't hear anything — try again.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const fd = new FormData();
      fd.append("audio", blob, "audio");

      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: fd,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`status ${res.status}`);
      }
      const data: { text?: string } = await res.json();
      const text = (data.text ?? "").trim();
      if (!mountedRef.current) return;
      if (!text) {
        safeSetStatus("idle");
        return;
      }
      // Read value via ref so we append to whatever the user has typed
      // since we started recording, not the captured render-time value.
      const preCommit = valueRef.current;
      const current = preCommit.trim();
      const next = current ? `${current} ${text}` : text;
      redoSnapshotRef.current = preCommit;
      onChangeRef.current(next);
      if (mountedRef.current) setHasRedo(true);
      safeSetStatus("idle");
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      console.error("transcribe request failed", (err as Error)?.message);
      safeSetStatus("error");
      safeSetError("Couldn't transcribe. Try again or type it.");
    }
  }

  function handleMicClick() {
    if (disabled) return;
    if (status === "recording") {
      stopRecording();
    } else if (status === "idle" || status === "error") {
      void startRecording();
    }
  }

  function handleRedoClick() {
    if (disabled) return;
    const snapshot = redoSnapshotRef.current;
    if (snapshot === null) return;
    // Restore via ref so a concurrent parent re-render can't clobber this
    // write via a stale onChange closure.
    onChangeRef.current(snapshot);
    redoSnapshotRef.current = null;
    setHasRedo(false);
    // No textarea focus before starting — keeps the keyboard from popping
    // up and competing with recording UI while the user is walking.
    void startRecording();
  }

  const recording = status === "recording";
  const transcribing = status === "transcribing";

  const charCount = value.length;
  return (
    <div className={fill ? "flex h-full min-h-0 flex-col" : ""}>
      <div
        className={`flex flex-col rounded-card border border-hairline bg-surface ${
          fill ? "min-h-0 flex-1" : ""
        }`}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={fill ? undefined : rows}
          maxLength={maxLength}
          disabled={disabled}
          aria-label={ariaLabel}
          // text-base (16px) — below 16px iOS Safari auto-zooms on focus.
          className={`w-full resize-none bg-transparent px-4 pt-3.5 text-base leading-[1.5] text-ink placeholder:text-ink-soft focus:outline-none disabled:opacity-60 ${
            fill ? "min-h-0 flex-1" : ""
          }`}
          placeholder={placeholder}
        />
        {/* Footer row: voice-wave pill (record toggle) + mono char counter. */}
        <div className="flex items-center justify-between gap-2 border-t border-hairline px-3 py-2">
          <button
            type="button"
            onClick={handleMicClick}
            disabled={disabled || transcribing}
            aria-label={recording ? "Stop recording" : "Start voice input"}
            className={`inline-flex min-h-11 items-center gap-2 rounded-pill px-3 py-1.5 transition active:scale-95 disabled:opacity-50 ${
              recording ? "bg-danger/15 text-danger" : "bg-accent-soft text-accent-ink"
            }`}
          >
            {transcribing ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent-ink/40 border-t-accent-ink" />
            ) : recording ? (
              <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-danger" />
            ) : (
              <VoiceWave />
            )}
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.8px]">
              {transcribing
                ? "Transcribing"
                : recording
                  ? `${secondsLeft}s · stop`
                  : "Speak"}
            </span>
          </button>
          <span className="font-mono text-[10px] tabular-nums tracking-[0.8px] text-ink-soft">
            {maxLength ? `${charCount} / ${maxLength}` : charCount}
          </span>
        </div>
      </div>
      {/* Reserve vertical space so the hint -> recording -> silent-typing
          transitions don't cause a layout shift mid-interaction. */}
      <div className="mt-1.5 min-h-[1.1rem] shrink-0">
        {error && <span className="text-[12px] font-medium text-danger">{error}</span>}
        {!error && recording && (
          <span className="flex items-center gap-2 text-[12px] font-medium text-danger">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-danger" />
            Recording… {secondsLeft}s remaining
          </span>
        )}
        {!error && !recording && !transcribing && !value && (
          <span className="text-[11px] font-medium text-ink-soft">
            Speak up to 45 seconds — brief and clear works best.
          </span>
        )}
      </div>
      {status === "idle" && hasRedo && (
        <div className="mt-2 shrink-0">
          <button
            type="button"
            onClick={handleRedoClick}
            disabled={disabled}
            aria-label="Redo voice input"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-hairline bg-surface px-4 py-2 text-[13px] font-medium text-ink-soft active:opacity-80 disabled:opacity-50"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            Redo
          </button>
        </div>
      )}
    </div>
  );
}

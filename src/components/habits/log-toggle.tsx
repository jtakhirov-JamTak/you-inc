"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Lock } from "lucide-react";
import { cn, safeUUID } from "@/lib/utils";

// Shared props every LogToggle needs to log a given day. Re-exported so callers
// (Home, the roster) can spread a single context object onto the control.
export interface ToggleCtx {
  localDate: string;
  locked: boolean;
  dateLabel: string;
  onResult: (msg: string) => void;
}

// The client's own today + IANA zone, captured at tap time (the authoritative
// "what local day is it for this user right now"). Sent with every log so the
// server buckets it correctly and rejects future dates.
export function clientToday(): { localDate: string; tz: string } {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return { localDate, tz };
}

// Tap-to-log control for a given day. Asset: "Mark done"; liability: "Mark
// paid" (the affirmative-good action — there is no slip button). Both turn accent
// when logged. A second tap undoes the day's log. The natural-key idempotency on
// (user, habit, local_date) makes a double-tap a no-op; router.refresh() reconciles
// the server's logged state after each tap. A day in a settled week renders locked.
export function LogToggle({
  habitId,
  kind,
  logged,
  localDate,
  locked,
  dateLabel,
  onResult,
}: {
  habitId: string;
  kind: "asset" | "liability";
  logged: boolean;
} & ToggleCtx) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const isAsset = kind === "asset";
  const onLabel = isAsset ? "Done" : "Paid";
  const offLabel = isAsset ? "Mark done" : "Mark paid";
  const doneVerb = isAsset ? "done" : "paid";

  async function tap() {
    if (pending || locked) return;
    setPending(true);
    setFailed(false);
    const action = logged ? "undo" : "log";
    // localDate is the day this control logs; tz is still captured client-side for
    // the server's future-date guard and occurred_tz.
    const { tz } = clientToday();
    try {
      const res = await fetch("/api/habits/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          habitId,
          localDate,
          occurredTz: tz,
          sourceSessionId: safeUUID(),
          action,
        }),
      });
      if (!res.ok) throw new Error();
      onResult(action === "undo" ? `Undone for ${dateLabel}` : `Marked ${doneVerb} for ${dateLabel}`);
      router.refresh();
    } catch {
      setFailed(true);
      onResult(`Couldn’t save for ${dateLabel} — tap to retry`);
    } finally {
      setPending(false);
    }
  }

  // Settled-week day → locked (the 0011 trigger would 409 a write anyway).
  if (locked) {
    return (
      <button
        type="button"
        disabled
        aria-label={`${dateLabel} is in a settled week — locked`}
        className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-pill border border-hairline bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-soft opacity-60"
      >
        <Lock className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
        Locked
      </button>
    );
  }

  const onTone = "bg-accent text-accent-text border-transparent";
  const label = failed
    ? "Couldn’t save — tap to retry"
    : logged
      ? `${onLabel} for ${dateLabel}, tap to undo`
      : `${offLabel} for ${dateLabel}`;

  return (
    <button
      type="button"
      onClick={tap}
      disabled={pending}
      aria-pressed={logged}
      aria-label={label}
      // role=status so a screen reader hears the retry prompt when a tap fails.
      role={failed ? "status" : undefined}
      className={cn(
        // min-h-11 → 44px touch target (this is the daily-tapped control).
        "flex min-h-11 shrink-0 items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[12px] font-semibold transition active:scale-95 disabled:opacity-50",
        failed
          ? "border-danger/40 bg-surface text-danger"
          : logged
            ? onTone
            : "border-hairline bg-surface text-ink-soft",
      )}
    >
      {logged && !failed && <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
      {pending ? "…" : failed ? "Retry" : logged ? onLabel : offLabel}
    </button>
  );
}

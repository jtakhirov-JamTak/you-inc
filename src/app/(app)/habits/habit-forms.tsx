"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Kicker } from "@/components/ui/kicker";
import { TextArea } from "@/components/ui/text-area";
import { pillAccentClass, SecondaryButton } from "@/components/ui/button";
import {
  AREAS,
  CADENCE_COPY,
  TERMS,
  type HabitView,
} from "./habit-roster-shared";

// Small chip used for area / term / weekday pickers.
export function Chip({
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
        "min-h-11 rounded-pill border px-3 text-[13px] font-semibold transition active:scale-95",
        active
          ? "border-transparent bg-accent text-accent-text"
          : "border-hairline bg-surface text-ink-soft",
      )}
    >
      {children}
    </button>
  );
}

export function EditForm({
  habit,
  onClose,
  onResult,
}: {
  habit: HabitView;
  onClose: () => void;
  onResult: (msg: string) => void;
}) {
  const router = useRouter();
  const isAsset = habit.kind === "asset";

  const [title, setTitle] = useState(habit.title);
  const [area, setArea] = useState<(typeof AREAS)[number] | null>(habit.area);
  const [term, setTerm] = useState<(typeof TERMS)[number]>(
    (TERMS as readonly number[]).includes(habit.term_days ?? 0)
      ? (habit.term_days as (typeof TERMS)[number])
      : 14,
  );
  const [submitting, setSubmitting] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cadenceTag =
    isAsset && habit.cadence ? CADENCE_COPY[habit.cadence].tag : "Vice";
  const canSave = !!title.trim() && !submitting;

  async function save() {
    if (!canSave) return;
    setSubmitting(true);
    setError(null);
    const body: Record<string, unknown> = {
      habitId: habit.id,
      title: title.trim(),
      area: area ?? null,
    };
    if (isAsset) body.termDays = term;
    try {
      const res = await fetch("/api/habits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Could not save this habit.");
      }
      onResult(`Saved ${title.trim()}`);
      router.refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  async function remove() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/habits", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ habitId: habit.id }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Could not remove this habit.");
      }
      onResult(`Removed ${habit.title}`);
      router.refresh();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-card border border-hairline bg-surface-tint p-4">
      <div className="flex items-baseline justify-between">
        <Kicker>Edit habit</Kicker>
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
          {cadenceTag} · fixed
        </span>
      </div>

      <div className="mt-2">
        <TextArea
          value={title}
          onChange={setTitle}
          placeholder="Habit name"
          rows={2}
          maxLength={80}
          ariaLabel="Habit name"
        />
      </div>

      {isAsset && (
        <div className="mt-3">
          <Kicker>Review term</Kicker>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {TERMS.map((t) => (
              <Chip key={t} active={term === t} onClick={() => setTerm(t)}>
                {t}d
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3">
        <Kicker>Area (optional)</Kicker>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {AREAS.map((a) => (
            <Chip key={a} active={area === a} onClick={() => setArea(area === a ? null : a)}>
              {a}
            </Chip>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-[10px] bg-surface px-3 py-2 text-[13px] font-medium text-danger">
          {error}
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <SecondaryButton onClick={onClose} className="flex-1">
          Cancel
        </SecondaryButton>
        <button
          type="button"
          disabled={!canSave}
          onClick={save}
          className={cn(pillAccentClass, "h-12 flex-1 text-[14px]")}
        >
          {submitting && !confirmRemove ? "Saving…" : "Save"}
        </button>
      </div>

      {/* Archive — two-tap confirm. Keeps history; frees the slot. */}
      <div className="mt-3 border-t border-divider pt-3">
        {confirmRemove ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[12px] leading-snug text-ink-soft">
              Remove this habit? It stops counting and frees the slot — your check-in history is kept.
            </span>
            <button
              type="button"
              disabled={submitting}
              onClick={remove}
              aria-label={`Confirm remove ${habit.title}`}
              className="min-h-11 shrink-0 rounded-pill border border-danger/40 bg-surface px-3 text-[13px] font-semibold text-danger transition active:scale-95 disabled:opacity-50"
            >
              {submitting ? "Removing…" : "Confirm"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            className="min-h-11 text-[13px] font-semibold text-danger transition active:scale-95"
          >
            Remove habit
          </button>
        )}
      </div>
    </div>
  );
}

export function SlotForm({
  title,
  setTitle,
  area,
  setArea,
  term,
  setTerm,
  showTerm,
  placeholder,
  error,
  submitting,
  canSubmit,
  onSubmit,
  onCancel,
}: {
  title: string;
  setTitle: (v: string) => void;
  area: (typeof AREAS)[number] | null;
  setArea: (v: (typeof AREAS)[number] | null) => void;
  term: number;
  setTerm: (v: (typeof TERMS)[number]) => void;
  showTerm: boolean;
  placeholder: string;
  error: string | null;
  submitting: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-card border border-hairline bg-surface-tint p-4">
      <TextArea
        value={title}
        onChange={setTitle}
        placeholder={placeholder}
        rows={2}
        maxLength={80}
        ariaLabel="Habit name"
      />

      {showTerm && (
        <div className="mt-3">
          <Kicker>Review term</Kicker>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {TERMS.map((t) => (
              <Chip key={t} active={term === t} onClick={() => setTerm(t)}>
                {t}d
              </Chip>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3">
        <Kicker>Area (optional)</Kicker>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {AREAS.map((a) => (
            <Chip key={a} active={area === a} onClick={() => setArea(area === a ? null : a)}>
              {a}
            </Chip>
          ))}
        </div>
      </div>

      {error && (
        // On plain surface (not the tinted form bg) so danger text clears AA.
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
          onClick={onSubmit}
          className={cn(pillAccentClass, "h-12 flex-1 text-[14px]")}
        >
          {submitting ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
}

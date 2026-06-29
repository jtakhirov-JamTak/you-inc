"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { inputClass } from "@/components/ui/field";
import { Kicker } from "@/components/ui/kicker";
import { pillAccentClass } from "@/components/ui/button";

// Mission habit — the per-day asset (cadence 'mission') authored from the Mission
// tab. Read view shows the current habit; the create/replace flow reveals an
// inline mini-form (title · area · review term) that POSTs to the endpoint and
// refreshes the server tree.

const AREAS = [
  { value: "health", label: "Health" },
  { value: "wealth", label: "Wealth" },
  { value: "relationships", label: "Relationships" },
] as const;
type Area = (typeof AREAS)[number]["value"];

const TERMS = [7, 14, 30, 60] as const;
type Term = (typeof TERMS)[number];

const AREA_LABEL: Record<string, string> = {
  health: "Health",
  wealth: "Wealth",
  relationships: "Relationships",
};

// Local chip — a 44px-tall toggle. aria-pressed carries selection to AT.
function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex min-h-11 items-center rounded-pill border px-3.5 text-[13px] font-semibold transition active:scale-95",
        selected
          ? "border-ink bg-ink text-surface"
          : "border-hairline bg-surface text-ink-soft",
      )}
    >
      {label}
    </button>
  );
}

export function MissionHabit({
  current,
}: {
  current: { title: string; area: string | null; termDays: number | null } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [area, setArea] = useState<Area | null>(null);
  const [term, setTerm] = useState<Term | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = title.trim().length > 0 && !!area && !!term && !saving;

  async function submit() {
    if (!canSave || !area || !term) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/identity/mission-habit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), area, termDays: term }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Could not create your Mission habit.");
      }
      setOpen(false);
      setTitle("");
      setArea(null);
      setTerm(null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const form = (
    <div className="mt-3 space-y-3.5 rounded-card border border-hairline bg-surface p-4">
      <div>
        <Kicker as="h3" className="text-ink-muted">
          Mission habit
        </Kicker>
        <input
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError(null);
          }}
          maxLength={80}
          placeholder="The one daily move toward your mission"
          aria-label="Mission habit title"
          className={cn(inputClass, "mt-2 h-12 text-[16px] font-bold tracking-[-0.01em]")}
        />
      </div>

      <div>
        <span className="mb-2 block font-mono text-[8.5px] font-medium uppercase tracking-[0.12em] text-ink-muted">
          Area
        </span>
        <div className="flex flex-wrap gap-2">
          {AREAS.map((a) => (
            <Chip
              key={a.value}
              label={a.label}
              selected={area === a.value}
              onClick={() => {
                setArea(a.value);
                setError(null);
              }}
            />
          ))}
        </div>
      </div>

      <div>
        <span className="mb-2 block font-mono text-[8.5px] font-medium uppercase tracking-[0.12em] text-ink-muted">
          Review every
        </span>
        <div className="flex flex-wrap gap-2">
          {TERMS.map((t) => (
            <Chip
              key={t}
              label={`${t} days`}
              selected={term === t}
              onClick={() => {
                setTerm(t);
                setError(null);
              }}
            />
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-[12.5px] font-medium text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!canSave}
          onClick={submit}
          className={cn(pillAccentClass, "h-12 flex-1 text-[14px]")}
        >
          {saving ? "Saving…" : current ? "Replace habit" : "Create habit"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="flex min-h-11 items-center rounded-pill border border-hairline px-4 text-[13px] font-semibold text-ink-soft transition active:scale-95"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  if (current) {
    return (
      <div className="mt-3 rounded-card border border-hairline bg-surface p-4">
        <div className="flex items-center gap-1 font-mono text-[8.5px] font-medium uppercase tracking-[0.1em] text-ink-muted">
          <span className="text-positive">●</span>
          Mission habit
        </div>
        <div className="mt-1 text-[16px] font-extrabold leading-tight tracking-[-0.01em] text-ink">
          {current.title}
        </div>
        <p className="mt-1.5 text-[11.5px] leading-snug text-ink-soft">
          {current.area && AREA_LABEL[current.area] ? AREA_LABEL[current.area] : "—"}
          {current.termDays ? ` · Reviews every ${current.termDays} days` : ""}
        </p>
        {open ? (
          form
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-3 flex min-h-11 items-center rounded-pill border border-hairline px-4 text-[13px] font-semibold text-ink-soft transition active:scale-95"
          >
            Replace
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3">
      {open ? (
        form
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(pillAccentClass, "h-12 w-full text-[14px]")}
        >
          Create your Mission Habit
        </button>
      )}
    </div>
  );
}

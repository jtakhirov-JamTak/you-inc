"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn, safeUUID } from "@/lib/utils";
import { inputClass } from "@/components/ui/field";
import { Kicker } from "@/components/ui/kicker";
import dynamic from "next/dynamic";
import { pillAccentClass, SecondaryButton } from "@/components/ui/button";

// Lazy-load VoiceInput so the audio/recorder code isn't in the initial bundle.
// Placeholder reserves the textarea height to avoid layout shift on hydrate.
const VoiceInput = dynamic(
  () => import("@/components/voice-input").then((m) => m.VoiceInput),
  {
    ssr: false,
    loading: () => (
      <div className="h-[96px] rounded-card border border-hairline bg-surface" />
    ),
  },
);

export type ValueRow = { title: string; meaning: string };
export type ModeKey = "baseline" | "close_people" | "under_pressure";
export type ModeRow = { mode_key: ModeKey; mode_name: string; description: string };
export type AffRow = { affirmation: string; visualization: string };

const MODE_COPY: Record<ModeKey, { eyebrow: string; aria: string; hint: string }> = {
  baseline: {
    eyebrow: "Default mode",
    aria: "Default mode",
    hint: 'How you are by default — e.g. "The Listener".',
  },
  close_people: {
    eyebrow: "With close people",
    aria: "With close people",
    hint: 'Who you become for those closest — e.g. "The Leader".',
  },
  under_pressure: {
    eyebrow: "Under pressure",
    aria: "Under pressure",
    hint: 'Who shows up when it’s hard — e.g. "The Strategist".',
  },
};
const MAX_AFFIRMATIONS = 7;

export function IdentityCharter({
  initialValues,
  initialModes,
  initialAffirmations,
}: {
  initialValues: ValueRow[];
  initialModes: ModeRow[];
  initialAffirmations: AffRow[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<ValueRow[]>(initialValues);
  const [modes, setModes] = useState<ModeRow[]>(initialModes);
  // Carry a stable client key per affirmation so adding/removing rows by index
  // can't mis-associate a focused field or remount the wrong textarea.
  const [affirmations, setAffirmations] = useState<(AffRow & { _key: string })[]>(
    () => initialAffirmations.map((a) => ({ ...a, _key: safeUUID() })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function patchValue(i: number, patch: Partial<ValueRow>) {
    setValues((prev) => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
    setSavedAt(null);
  }
  function patchMode(i: number, patch: Partial<ModeRow>) {
    setModes((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
    setSavedAt(null);
  }
  function patchAff(i: number, patch: Partial<AffRow>) {
    setAffirmations((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
    setSavedAt(null);
  }
  function addAff() {
    setAffirmations((prev) =>
      prev.length >= MAX_AFFIRMATIONS
        ? prev
        : [...prev, { affirmation: "", visualization: "", _key: safeUUID() }],
    );
    setSavedAt(null);
  }
  function removeAff(i: number) {
    setAffirmations((prev) => prev.filter((_, idx) => idx !== i));
    setSavedAt(null);
  }

  const valuesComplete = values.every((v) => v.title.trim() && v.meaning.trim());
  const modesComplete = modes.every((m) => m.mode_name.trim() && m.description.trim());
  // Affirmations are optional, but any present one must be complete.
  const affirmationsValid = affirmations.every(
    (a) => a.affirmation.trim() && a.visualization.trim(),
  );
  const canSave = valuesComplete && modesComplete && affirmationsValid && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const body = {
      values: values.map((v, i) => ({
        position: i + 1,
        title: v.title.trim(),
        meaning: v.meaning.trim(),
      })),
      modes: modes.map((m) => ({
        mode_key: m.mode_key,
        mode_name: m.mode_name.trim(),
        description: m.description.trim(),
      })),
      affirmations: affirmations
        .filter((a) => a.affirmation.trim() && a.visualization.trim())
        .map((a) => ({ affirmation: a.affirmation.trim(), visualization: a.visualization.trim() })),
    };
    try {
      const res = await fetch("/api/identity", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Could not save your charter.");
      }
      setSavedAt(Date.now());
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8 pb-10">
      {/* Core values */}
      <section className="mt-7">
        <Kicker as="h2" className="tracking-[0.12em] text-ink-muted">
          Core values
        </Kicker>
        <p className="mt-1.5 text-[12.5px] font-medium leading-[1.4] text-ink-soft">
          The three you actually run on. Name each and what it means to you.
        </p>
        <div className="mt-3.5 divide-y divide-divider overflow-hidden rounded-card border border-hairline bg-surface">
          {values.map((v, i) => (
            <div key={i} className="space-y-2.5 p-4">
              <input
                type="text"
                value={v.title}
                onChange={(e) => patchValue(i, { title: e.target.value })}
                maxLength={60}
                placeholder={`Value ${i + 1} — e.g. Integrity`}
                aria-label={`Value ${i + 1} name`}
                className={cn(
                  inputClass,
                  "h-11 border-divider bg-surface text-[16px] font-bold tracking-[-0.01em]",
                )}
              />
              <VoiceInput
                value={v.meaning}
                onChange={(next) => patchValue(i, { meaning: next })}
                placeholder="What it means to you, in your words…"
                rows={2}
                maxLength={300}
                ariaLabel={`Value ${i + 1} meaning`}
              />
            </div>
          ))}
        </div>
      </section>

      {/* How people experience you */}
      <section>
        <Kicker as="h2" className="tracking-[0.12em] text-ink-muted">
          How people experience you
        </Kicker>
        <p className="mt-1.5 text-[12.5px] font-medium leading-[1.4] text-ink-soft">
          Three fixed contexts. Name who you are in each and describe it in a line.
        </p>
        <div className="mt-3.5 space-y-2.5">
          {modes.map((m, i) => {
            const isDefault = m.mode_key === "baseline";
            return (
              <div
                key={m.mode_key}
                className={cn(
                  "rounded-card p-4",
                  isDefault
                    ? "bg-accent text-accent-text"
                    : "border border-hairline bg-surface",
                )}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span
                    className={cn(
                      "font-mono text-[9px] font-medium uppercase tracking-[0.12em]",
                      isDefault ? "text-ink-faint" : "text-ink-muted",
                    )}
                  >
                    {MODE_COPY[m.mode_key].eyebrow}
                  </span>
                  {isDefault && (
                    <span className="font-mono text-[9px] font-medium uppercase tracking-[0.08em] text-positive-on-dark">
                      ● Active
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  value={m.mode_name}
                  onChange={(e) => patchMode(i, { mode_name: e.target.value })}
                  maxLength={60}
                  placeholder="Name this mode — e.g. The Listener"
                  aria-label={`${MODE_COPY[m.mode_key].aria} — mode name`}
                  className={cn(
                    "h-11 w-full rounded-card-sm border bg-transparent px-3 text-[16px] font-extrabold tracking-[-0.02em] focus:outline-none focus:ring-2 focus:ring-accent",
                    isDefault
                      ? "border-white/20 text-accent-text placeholder:text-ink-faint"
                      : "border-divider text-ink placeholder:text-ink-soft",
                  )}
                />
                <div className="mt-2">
                  <VoiceInput
                    value={m.description}
                    onChange={(next) => patchMode(i, { description: next })}
                    placeholder={MODE_COPY[m.mode_key].hint}
                    rows={2}
                    maxLength={200}
                    ariaLabel={`${MODE_COPY[m.mode_key].aria} — description`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Affirmations */}
      <section>
        <Kicker as="h2" className="tracking-[0.12em] text-ink-muted">
          Affirmations · optional
        </Kicker>
        <p className="mt-1.5 text-[12.5px] font-medium leading-[1.4] text-ink-soft">
          Each pairs a statement with an objective thing you can picture.
        </p>
        <div className="mt-3.5 space-y-2.5">
          {affirmations.map((a, i) => (
            <div key={a._key} className="space-y-2.5 rounded-card border border-hairline bg-surface p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                  Affirmation {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeAff(i)}
                  aria-label={`Remove affirmation ${i + 1}`}
                  className="-mr-2 inline-flex min-h-11 items-center px-2 text-[12px] font-semibold text-ink-soft active:scale-95"
                >
                  Remove
                </button>
              </div>
              <VoiceInput
                value={a.affirmation}
                onChange={(next) => patchAff(i, { affirmation: next })}
                placeholder="The statement…"
                rows={2}
                maxLength={300}
                ariaLabel={`Affirmation ${i + 1} statement`}
              />
              <VoiceInput
                value={a.visualization}
                onChange={(next) => patchAff(i, { visualization: next })}
                placeholder="What you picture — objective and concrete…"
                rows={2}
                maxLength={300}
                ariaLabel={`Affirmation ${i + 1} visualization`}
              />
            </div>
          ))}
          {affirmations.length < MAX_AFFIRMATIONS && (
            <SecondaryButton onClick={addAff} className="w-full">
              + Add affirmation
            </SecondaryButton>
          )}
        </div>
      </section>

      {/* Footer rule — the Regulation principle surfacing on Identity */}
      <div className="flex items-center justify-center rounded-pill border border-dashed border-hairline px-4 py-3.5">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-ink-muted">
          Regulate first, then decide
        </span>
      </div>

      {error && <p role="alert" className="text-[13px] font-medium text-danger">{error}</p>}
      {savedAt && !error && (
        <p role="status" className="text-[13px] font-medium text-positive">
          Charter saved.
        </p>
      )}
      {!valuesComplete || !modesComplete ? (
        <p className="text-[12px] font-medium text-ink-soft">
          Fill all three values and all three modes to save.
        </p>
      ) : null}

      <button
        type="button"
        disabled={!canSave}
        onClick={save}
        className={cn(pillAccentClass, "h-14 w-full text-[15px]")}
      >
        {saving ? "Saving…" : "Save charter"}
      </button>
    </div>
  );
}

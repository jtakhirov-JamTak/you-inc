"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn, safeUUID } from "@/lib/utils";
import { inputClass } from "@/components/ui/field";
import { Card } from "@/components/ui/card";
import { Kicker } from "@/components/ui/kicker";
import { VoiceInput } from "@/components/voice-input";
import { pillAccentClass, SecondaryButton } from "@/components/ui/button";

export type ValueRow = { title: string; meaning: string };
export type ModeKey = "baseline" | "close_people" | "under_pressure";
export type ModeRow = { mode_key: ModeKey; mode_name: string; description: string };
export type AffRow = { affirmation: string; visualization: string };

const MODE_COPY: Record<ModeKey, { label: string; hint: string }> = {
  baseline: { label: "Baseline (default)", hint: 'How you are by default — e.g. "The Listener".' },
  close_people: { label: "With close people", hint: 'Who you become for those closest — e.g. "The Leader".' },
  under_pressure: { label: "Under pressure", hint: 'Who shows up when it’s hard — e.g. "The Strategist".' },
};
const MAX_AFFIRMATIONS = 7;

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="block text-[13px] font-semibold text-ink">{children}</span>;
}

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
    <div className="space-y-4">
      {/* Values */}
      <Card className="p-5">
        <Kicker as="h2">Values · exactly three</Kicker>
        <p className="mt-2 text-[13px] font-medium leading-[1.5] text-ink-soft">
          The three you actually run on. Name each and what it means to you.
        </p>
        <div className="mt-4 space-y-4">
          {values.map((v, i) => (
            <div key={i} className="space-y-2">
              <FieldLabel>Value {i + 1}</FieldLabel>
              <input
                type="text"
                value={v.title}
                onChange={(e) => patchValue(i, { title: e.target.value })}
                maxLength={60}
                placeholder="e.g. Integrity"
                aria-label={`Value ${i + 1} name`}
                className={cn(inputClass, "bg-surface-tint")}
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
      </Card>

      {/* Modes */}
      <Card className="p-5">
        <Kicker as="h2">Modes · how people experience you</Kicker>
        <p className="mt-2 text-[13px] font-medium leading-[1.5] text-ink-soft">
          Three fixed contexts. Name who you are in each and describe it in a line.
        </p>
        <div className="mt-4 space-y-4">
          {modes.map((m, i) => (
            <div key={m.mode_key} className="space-y-2">
              <FieldLabel>{MODE_COPY[m.mode_key].label}</FieldLabel>
              <input
                type="text"
                value={m.mode_name}
                onChange={(e) => patchMode(i, { mode_name: e.target.value })}
                maxLength={60}
                placeholder="Name this mode"
                aria-label={`${MODE_COPY[m.mode_key].label} — mode name`}
                className={cn(inputClass, "bg-surface-tint")}
              />
              <VoiceInput
                value={m.description}
                onChange={(next) => patchMode(i, { description: next })}
                placeholder={MODE_COPY[m.mode_key].hint}
                rows={2}
                maxLength={200}
                ariaLabel={`${MODE_COPY[m.mode_key].label} — description`}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* Affirmations */}
      <Card className="p-5">
        <Kicker as="h2">Affirmations · optional</Kicker>
        <p className="mt-2 text-[13px] font-medium leading-[1.5] text-ink-soft">
          Each pairs a statement with an objective thing you can picture.
        </p>
        <div className="mt-4 space-y-4">
          {affirmations.map((a, i) => (
            <div key={a._key} className="rounded-[14px] border border-hairline bg-surface-tint p-4 space-y-2">
              <div className="flex items-center justify-between">
                <FieldLabel>Affirmation {i + 1}</FieldLabel>
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
      </Card>

      <p className="px-1 text-center font-mono text-[10px] uppercase tracking-[1.3px] text-ink-soft">
        Regulate first, then decide.
      </p>

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

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn, safeUUID } from "@/lib/utils";
import { inputClass } from "@/components/ui/field";
import { Kicker } from "@/components/ui/kicker";
import { TextArea } from "@/components/ui/text-area";
import { pillAccentClass, SecondaryButton } from "@/components/ui/button";

export type ValueRow = { title: string; meaning: string };
export type ModeKey = "baseline" | "close_people" | "under_pressure";
export type ModeRow = { mode_key: ModeKey; mode_name: string; description: string };
export type AffRow = { affirmation: string; visualization: string };

export const MODE_COPY: Record<ModeKey, { eyebrow: string; aria: string; hint: string }> = {
  baseline: {
    eyebrow: "Baseline",
    aria: "Baseline brand",
    hint: 'Your default brand — e.g. "The Listener".',
  },
  close_people: {
    eyebrow: "With close people",
    aria: "Brand with close people",
    hint: 'Your brand for those closest — e.g. "The Leader".',
  },
  under_pressure: {
    eyebrow: "Under pressure",
    aria: "Brand under pressure",
    hint: 'Your brand when it’s hard — e.g. "The Strategist".',
  },
};
// The charter holds a single affirmation (a quote, philosophy, or your own).
const MAX_AFFIRMATIONS = 1;

export function IdentityCharter({
  initialMission,
  initialValues,
  initialModes,
  initialAffirmations,
  onSaved,
}: {
  initialMission: string;
  initialValues: ValueRow[];
  initialModes: ModeRow[];
  initialAffirmations: AffRow[];
  // Called after a successful save (post router.refresh) — lets the parent return
  // to the read view. Omit to keep the form standalone.
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [mission, setMission] = useState(initialMission);
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
      mission: mission.trim(),
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
      onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8 pb-10">
      {/* Mission — the 1–3 word statement (optional). */}
      <section className="mt-7">
        <Kicker as="h2" className="tracking-[0.12em] text-ink-muted">
          Mission
        </Kicker>
        <p className="mt-1.5 text-[12.5px] font-medium leading-[1.4] text-ink-soft">
          One to three words for what you’re building.
        </p>
        <input
          type="text"
          value={mission}
          onChange={(e) => {
            setMission(e.target.value);
            setSavedAt(null);
          }}
          maxLength={60}
          placeholder="Your mission — 1–3 words"
          aria-label="Mission"
          className={cn(
            inputClass,
            "mt-3.5 h-12 text-[16px] font-bold tracking-[-0.01em]",
          )}
        />
      </section>

      {/* Brand — how people experience you, across three fixed contexts. A
          sub-section under Mission (it sits directly after the statement). */}
      <section>
        <Kicker as="h2" className="tracking-[0.12em] text-ink-muted">
          Brand
        </Kicker>
        <p className="mt-1.5 text-[12.5px] font-medium leading-[1.4] text-ink-soft">
          Three fixed contexts. Name your brand in each, then your offer — how you
          make people feel.
        </p>
        <div className="mt-3.5 space-y-2.5">
          {modes.map((m, i) => {
            const isDefault = m.mode_key === "baseline";
            return (
              <div
                key={m.mode_key}
                className="rounded-card border border-hairline bg-surface p-4"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                    {MODE_COPY[m.mode_key].eyebrow}
                  </span>
                  {isDefault && (
                    // Active mode signals with the small green dot only (handoff §3) —
                    // no longer a full ink card.
                    <span className="font-mono text-[9px] font-medium uppercase tracking-[0.08em] text-positive">
                      ● Active
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  value={m.mode_name}
                  onChange={(e) => patchMode(i, { mode_name: e.target.value })}
                  maxLength={60}
                  placeholder={MODE_COPY[m.mode_key].hint}
                  aria-label={`${MODE_COPY[m.mode_key].aria} — name`}
                  className="h-11 w-full rounded-card-sm border border-divider bg-transparent px-3 text-[16px] font-extrabold tracking-[-0.02em] text-ink placeholder:text-ink-soft focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <div className="mt-2.5">
                  <span className="mb-1 block font-mono text-[8.5px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                    Offer
                  </span>
                  <TextArea
                    value={m.description}
                    onChange={(next) => patchMode(i, { description: next })}
                    placeholder="How you make people feel — a couple of words"
                    rows={2}
                    maxLength={200}
                    ariaLabel={`${MODE_COPY[m.mode_key].aria} — offer`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Core values */}
      <section>
        <Kicker as="h2" className="tracking-[0.12em] text-ink-muted">
          Core values
        </Kicker>
        <p className="mt-1.5 text-[12.5px] font-medium leading-[1.4] text-ink-soft">
          The three you actually run on — how you execute the mission. Name each and
          what it means to you.
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
              <TextArea
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

      {/* Mantra */}
      <section>
        <Kicker as="h2" className="tracking-[0.12em] text-ink-muted">
          Mantra · optional
        </Kicker>
        <p className="mt-1.5 text-[12.5px] font-medium leading-[1.4] text-ink-soft">
          A line to help motivate you — a quote that inspires you, a philosophy you
          live by, or write your own. Phrase it as “You…”, not “I…”. Then picture the
          goal it points to.
        </p>
        <div className="mt-3.5 space-y-2.5">
          {affirmations.map((a, i) => (
            <div key={a._key} className="space-y-2.5 rounded-card border border-hairline bg-surface p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                  Mantra
                </span>
                <button
                  type="button"
                  onClick={() => removeAff(i)}
                  aria-label={`Remove mantra ${i + 1}`}
                  className="-mr-2 inline-flex min-h-11 items-center px-2 text-[12px] font-semibold text-ink-soft active:scale-95"
                >
                  Remove
                </button>
              </div>
              <div>
                <span className="mb-1 block font-mono text-[8.5px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                  Mantra
                </span>
                <TextArea
                  value={a.affirmation}
                  onChange={(next) => patchAff(i, { affirmation: next })}
                  placeholder="e.g. “You are calm under pressure.”"
                  rows={2}
                  maxLength={300}
                  ariaLabel={`Mantra ${i + 1} statement`}
                />
              </div>
              <div>
                <span className="mb-1 block font-mono text-[8.5px] font-medium uppercase tracking-[0.12em] text-ink-muted">
                  Goal visualization
                </span>
                <TextArea
                  value={a.visualization}
                  onChange={(next) => patchAff(i, { visualization: next })}
                  placeholder="The goal you picture — objective and concrete…"
                  rows={2}
                  maxLength={300}
                  ariaLabel={`Mantra ${i + 1} goal visualization`}
                />
              </div>
            </div>
          ))}
          {affirmations.length < MAX_AFFIRMATIONS && (
            <SecondaryButton onClick={addAff} className="w-full">
              + Add mantra
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
          Fill all three values and all three brands to save.
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

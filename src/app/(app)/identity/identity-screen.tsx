"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Kicker } from "@/components/ui/kicker";
import {
  IdentityCharter,
  MODE_COPY,
  type ValueRow,
  type ModeRow,
  type ModeKey,
  type AffRow,
} from "./identity-charter";

// Identity — the charter (handoff §3). The compact READ view is the default; an
// EDIT pill opens the existing edit form. A charter with nothing authored yet
// opens straight into edit so the user isn't staring at an empty page.

const MODE_ORDER: ModeKey[] = ["baseline", "close_people", "under_pressure"];

export function IdentityScreen({
  values,
  modes,
  affirmations,
}: {
  values: ValueRow[];
  modes: ModeRow[];
  affirmations: AffRow[];
}) {
  const hasContent =
    values.some((v) => v.title.trim()) || modes.some((m) => m.mode_name.trim());
  const [editing, setEditing] = useState(!hasContent);

  return (
    <div>
      {/* Header — title + the edit affordance (handoff §3). */}
      <header className="flex items-start justify-between pt-1">
        <div>
          <h1 className="font-display text-[24px] font-extrabold leading-none tracking-[-0.02em] text-ink">
            Identity
          </h1>
          <p className="mt-1 text-[12px] font-medium text-ink-soft">The charter you run on.</p>
        </div>
        {editing ? (
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={!hasContent}
            className="mt-0.5 shrink-0 rounded-[6px] border border-hairline px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-soft transition active:scale-95 disabled:opacity-40"
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Edit charter"
            className="mt-0.5 flex shrink-0 items-center gap-1 rounded-[6px] border border-hairline px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-soft transition active:scale-95"
          >
            <Pencil className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
            Edit
          </button>
        )}
      </header>

      {editing ? (
        <IdentityCharter
          initialValues={values}
          initialModes={modes}
          initialAffirmations={affirmations}
          onSaved={() => setEditing(false)}
        />
      ) : (
        <CharterView values={values} modes={modes} affirmations={affirmations} />
      )}
    </div>
  );
}

// The dense read view — values + modes + affirmations + footer, grouped into
// single multi-row cards (handoff §3 "the whole point is density").
function CharterView({
  values,
  modes,
  affirmations,
}: {
  values: ValueRow[];
  modes: ModeRow[];
  affirmations: AffRow[];
}) {
  const filledValues = values.filter((v) => v.title.trim() || v.meaning.trim());
  const orderedModes = MODE_ORDER.map((key) => modes.find((m) => m.mode_key === key)).filter(
    (m): m is ModeRow => !!m && !!m.mode_name.trim(),
  );
  const filledAff = affirmations.filter((a) => a.affirmation.trim());

  return (
    <div className="space-y-7 pb-10">
      {/* Core values */}
      <section className="mt-6">
        <Kicker as="h2" className="tracking-[0.12em] text-ink-muted">
          Core values
        </Kicker>
        <div className="mt-2.5 divide-y divide-divider overflow-hidden rounded-card border border-hairline bg-surface">
          {filledValues.map((v, i) => (
            <div key={i} className="flex gap-3 p-3.5">
              <span className="w-[84px] shrink-0 text-[13.5px] font-bold leading-snug text-ink">
                {v.title}
              </span>
              <span className="flex-1 text-[12px] leading-snug text-ink-soft">{v.meaning}</span>
            </div>
          ))}
        </div>
      </section>

      {/* How people experience you */}
      <section>
        <Kicker as="h2" className="tracking-[0.12em] text-ink-muted">
          How people experience you
        </Kicker>
        <div className="mt-2.5 divide-y divide-divider overflow-hidden rounded-card border border-hairline bg-surface">
          {orderedModes.map((m) => {
            const isDefault = m.mode_key === "baseline";
            return (
              <div key={m.mode_key} className="flex items-center gap-3 p-3.5">
                <div className="w-[104px] shrink-0">
                  <div className="flex items-center gap-1 font-mono text-[8.5px] font-medium uppercase tracking-[0.1em] text-ink-muted">
                    {isDefault && <span className="text-positive">●</span>}
                    {MODE_COPY[m.mode_key].eyebrow}
                  </div>
                  <div className="mt-1 text-[16px] font-extrabold leading-tight tracking-[-0.01em] text-ink">
                    {m.mode_name}
                  </div>
                </div>
                <p className="flex-1 text-[11.5px] leading-snug text-ink-soft">{m.description}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Affirmations (only when authored) */}
      {filledAff.length > 0 && (
        <section>
          <Kicker as="h2" className="tracking-[0.12em] text-ink-muted">
            Affirmations · {filledAff.length}
          </Kicker>
          <div className="mt-2.5 divide-y divide-divider overflow-hidden rounded-card border border-hairline bg-surface">
            {filledAff.map((a, i) => (
              <p key={i} className="p-3.5 text-[12.5px] leading-snug text-ink-soft">
                <span aria-hidden className="mr-1 font-mono text-ink-muted">
                  “
                </span>
                {a.affirmation}
              </p>
            ))}
          </div>
        </section>
      )}

      {/* Footer — the Regulation principle surfacing on Identity. */}
      <div className="flex items-center justify-center rounded-pill border border-dashed border-hairline px-4 py-3">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-soft">
          Regulate first, then decide
        </span>
      </div>
    </div>
  );
}

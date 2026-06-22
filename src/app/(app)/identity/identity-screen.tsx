"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import {
  IdentityCharter,
  MODE_COPY,
  type ValueRow,
  type ModeRow,
  type ModeKey,
  type AffRow,
} from "./identity-charter";

// Mission — the charter (renamed from Identity). The default READ view is a
// four-section accordion (Mission · Values · Brand · Affirmations), every
// section collapsed by default and expandable on tap. An EDIT pill opens the
// existing edit form. A charter with nothing authored opens straight into edit.

const MODE_ORDER: ModeKey[] = ["baseline", "close_people", "under_pressure"];

export function IdentityScreen({
  mission,
  values,
  modes,
  affirmations,
}: {
  mission: string;
  values: ValueRow[];
  modes: ModeRow[];
  affirmations: AffRow[];
}) {
  const hasContent =
    mission.trim().length > 0 ||
    values.some((v) => v.title.trim()) ||
    modes.some((m) => m.mode_name.trim());
  const [editing, setEditing] = useState(!hasContent);

  return (
    <div>
      {/* Header — title + the edit affordance. */}
      <header className="flex items-start justify-between pt-1">
        <div>
          <h1 className="font-display text-[24px] font-extrabold leading-none tracking-[-0.02em] text-ink">
            Mission
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
          initialMission={mission}
          initialValues={values}
          initialModes={modes}
          initialAffirmations={affirmations}
          onSaved={() => setEditing(false)}
        />
      ) : (
        <CharterView
          mission={mission}
          values={values}
          modes={modes}
          affirmations={affirmations}
        />
      )}
    </div>
  );
}

// The dense read view — four collapsible sections + the Regulation footer.
function CharterView({
  mission,
  values,
  modes,
  affirmations,
}: {
  mission: string;
  values: ValueRow[];
  modes: ModeRow[];
  affirmations: AffRow[];
}) {
  const trimmedMission = mission.trim();
  const filledValues = values.filter((v) => v.title.trim() || v.meaning.trim());
  const orderedModes = MODE_ORDER.map((key) => modes.find((m) => m.mode_key === key)).filter(
    (m): m is ModeRow => !!m && !!m.mode_name.trim(),
  );
  const baselineBrand = modes.find((m) => m.mode_key === "baseline")?.mode_name.trim() ?? "";
  const filledAff = affirmations.filter((a) => a.affirmation.trim());

  const valueNames = filledValues.map((v) => v.title.trim()).filter(Boolean);
  const notSet = <span className="font-medium text-ink-soft">Not set yet</span>;

  return (
    <div className="space-y-2.5 pb-10">
      {/* 1 · Mission */}
      <CollapsibleSection title="Mission" summary={trimmedMission || notSet}>
        {trimmedMission ? (
          <p className="font-display text-[22px] font-extrabold leading-tight tracking-[-0.02em] text-ink">
            {trimmedMission}
          </p>
        ) : (
          <p className="text-[12.5px] leading-snug text-ink-soft">
            One to three words for what you’re building. Add it from Edit.
          </p>
        )}
      </CollapsibleSection>

      {/* 2 · Values */}
      <CollapsibleSection
        title="Values"
        summary={valueNames.length ? valueNames.join(" · ") : notSet}
      >
        {filledValues.length ? (
          <div className="-mx-4 -mb-4 divide-y divide-divider">
            {filledValues.map((v, i) => (
              <div key={i} className="flex gap-3 px-4 py-3.5">
                <span className="w-[84px] shrink-0 text-[13.5px] font-bold leading-snug text-ink">
                  {v.title}
                </span>
                <span className="flex-1 text-[12px] leading-snug text-ink-soft">{v.meaning}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] leading-snug text-ink-soft">No values yet. Add them from Edit.</p>
        )}
      </CollapsibleSection>

      {/* 3 · Brand */}
      <CollapsibleSection title="Brand" summary={baselineBrand || notSet}>
        {orderedModes.length ? (
          <div className="-mx-4 -mb-4 divide-y divide-divider">
            {orderedModes.map((m) => {
              const isDefault = m.mode_key === "baseline";
              return (
                <div key={m.mode_key} className="px-4 py-3.5">
                  <div className="flex items-center gap-1 font-mono text-[8.5px] font-medium uppercase tracking-[0.1em] text-ink-muted">
                    {isDefault && <span className="text-positive">●</span>}
                    {MODE_COPY[m.mode_key].eyebrow}
                  </div>
                  <div className="mt-1 text-[16px] font-extrabold leading-tight tracking-[-0.01em] text-ink">
                    {m.mode_name}
                  </div>
                  {m.description.trim() && (
                    <p className="mt-1.5 text-[11.5px] leading-snug text-ink-soft">
                      <span className="mr-1.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-ink-muted">
                        Offer
                      </span>
                      {m.description}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[12.5px] leading-snug text-ink-soft">No brand yet. Add it from Edit.</p>
        )}
      </CollapsibleSection>

      {/* 4 · Affirmations — collapsed shows the full affirmation(s); expanded
          adds each one's goal visualization. */}
      <CollapsibleSection
        title="Affirmation"
        summary={
          filledAff.length ? (
            <span className="block space-y-0.5 font-medium text-ink">
              {filledAff.map((a, i) => (
                <span key={i} className="block leading-snug">
                  {a.affirmation.trim()}
                </span>
              ))}
            </span>
          ) : (
            notSet
          )
        }
      >
        {filledAff.length ? (
          <div className="-mx-4 -mb-4 divide-y divide-divider">
            {filledAff.map((a, i) => (
              <div key={i} className="px-4 py-3.5">
                <p className="text-[12.5px] leading-snug text-ink">
                  <span aria-hidden className="mr-1 font-mono text-ink-muted">
                    “
                  </span>
                  {a.affirmation}
                </p>
                {a.visualization.trim() && (
                  <p className="mt-1.5 text-[11.5px] leading-snug text-ink-soft">
                    <span className="mr-1.5 font-mono text-[8.5px] uppercase tracking-[0.1em] text-ink-muted">
                      Goal
                    </span>
                    {a.visualization}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12.5px] leading-snug text-ink-soft">
            None yet — affirmations are optional. Add a quote, a philosophy, or your
            own from Edit.
          </p>
        )}
      </CollapsibleSection>

      {/* Footer — the Regulation principle surfacing on the charter. */}
      <div className="mt-5 flex items-center justify-center rounded-pill border border-dashed border-hairline px-4 py-3">
        <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-soft">
          Regulate first, then decide
        </span>
      </div>
    </div>
  );
}

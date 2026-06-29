"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil } from "lucide-react";
import { cn, formatSignedDollars } from "@/lib/utils";
import { Kicker } from "@/components/ui/kicker";
import { CategoryBadge, badgeKindFor } from "@/components/ui/category-badge";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import {
  rosterStatus,
  type Cadence,
  type RosterSlot,
} from "@/lib/habits/roster";
import { EditForm, SlotForm } from "./habit-forms";
import {
  AREAS,
  CADENCE_COPY,
  SYSTEMS_ASSET_CADENCES,
  TERMS,
  type HabitView,
} from "./habit-roster-shared";

// Re-exported so the page keeps importing HabitView from this module.
export type { HabitView } from "./habit-roster-shared";

// Live per-position metrics from the price engine (getOperatingState), indexed by
// habit id. Mirrors the fields Home reads — same source, so the screens can't
// diverge. All nullable: a vice has no term/days-done, an asset no days-clean, and
// the whole map is empty if the engine read failed (cards fall back to neutral).
export interface HabitMetrics {
  dayOfTerm: number | null;
  daysDone: number | null;
  daysClean: number | null;
  contribCents: number;
}

// A graduated asset on the holdings shelf (snapshot row, survives source edits).
export interface GraduatedView {
  id: string;
  title: string;
  area: "health" | "wealth" | "relationships" | null;
  graduated_on: string;
}

// Show the term-review row this many days before the term ends (and after).
const REVIEW_WINDOW_DAYS = 2;

type OpenSlot = { kind: "asset"; cadence: Cadence } | { kind: "liability" } | null;

export function HabitRoster({
  initialHabits,
  metricsByHabit,
  graduated,
}: {
  initialHabits: HabitView[];
  metricsByHabit: Record<string, HabitMetrics>;
  graduated: GraduatedView[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<OpenSlot>(null);
  // The habit currently being edited (its card swaps to an inline edit/details form).
  const [editing, setEditing] = useState<string | null>(null);

  // Visually-hidden live status of the last setup action (for screen readers).
  const [announce, setAnnounce] = useState("");

  // form state
  const [title, setTitle] = useState("");
  const [area, setArea] = useState<(typeof AREAS)[number] | null>(null);
  const [term, setTerm] = useState<(typeof TERMS)[number]>(14);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slots: RosterSlot[] = initialHabits.map((h) => ({
    kind: h.kind,
    cadence: h.cadence,
  }));
  const status = rosterStatus(slots);

  const assets = initialHabits.filter((h) => h.kind === "asset");
  const vices = initialHabits.filter((h) => h.kind === "liability");
  // The Mission asset is authored on the Mission tab — shown here read-only.
  const mission = assets.find((h) => h.cadence === "mission") ?? null;

  // Collapsed-section summaries: the high-level roster at a glance.
  const assetTitles = assets.map((h) => h.title.trim()).filter(Boolean);
  const viceTitles = vices.map((h) => h.title.trim()).filter(Boolean);
  const assetsSummary = assetTitles.length ? (
    assetTitles.join(" · ")
  ) : (
    <span className="font-medium text-ink-muted">No assets yet</span>
  );
  const liabilitiesSummary = viceTitles.length ? (
    viceTitles.join(" · ")
  ) : (
    <span className="font-medium text-ink-muted">No liabilities yet</span>
  );

  function resetForm() {
    setTitle("");
    setArea(null);
    setTerm(14);
    setError(null);
  }

  function openSlot(slot: OpenSlot) {
    resetForm();
    setOpen(slot);
  }

  const canSubmit = !!title.trim() && !submitting;

  async function submit() {
    if (!open || !canSubmit) return;
    setSubmitting(true);
    setError(null);

    const body =
      open.kind === "asset"
        ? {
            kind: "asset",
            cadence: open.cadence,
            title: title.trim(),
            area: area ?? undefined,
            termDays: term,
          }
        : { kind: "liability", title: title.trim(), area: area ?? undefined };

    try {
      const res = await fetch("/api/habits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error || "Could not add this habit.");
      }
      setOpen(null);
      resetForm();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pb-10">
      {/* Visually-hidden live region — announces each setup action result. */}
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      <div className="mt-1 space-y-2.5">
      {/* ── Assets · building ─────────────────────────────────── */}
      <CollapsibleSection title="Assets" summary={assetsSummary}>
        <p className="-mt-0.5 mb-3 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
          Building · mature by accumulation
        </p>

        <div className="space-y-2.5">
          {SYSTEMS_ASSET_CADENCES.map((cadence) => {
            const held = assets.find((h) => h.cadence === cadence);
            const formOpen = open?.kind === "asset" && open.cadence === cadence;
            return (
              <div key={cadence}>
                {held ? (
                  editing === held.id ? (
                    <EditForm
                      habit={held}
                      onClose={() => setEditing(null)}
                      onResult={setAnnounce}
                    />
                  ) : (
                    <AssetCard
                      habitId={held.id}
                      cadence={cadence}
                      title={held.title}
                      termDays={held.term_days}
                      area={held.area}
                      metrics={metricsByHabit[held.id]}
                      onEdit={() => setEditing(held.id)}
                      onReplaced={() => openSlot({ kind: "asset", cadence })}
                    />
                  )
                ) : formOpen ? (
                  <SlotForm
                    title={title}
                    setTitle={setTitle}
                    area={area}
                    setArea={setArea}
                    term={term}
                    setTerm={setTerm}
                    showTerm
                    placeholder={`e.g. ${cadence === "morning" ? "Meditate 10 min" : "Evening shutdown"}`}
                    error={error}
                    submitting={submitting}
                    canSubmit={canSubmit}
                    onSubmit={submit}
                    onCancel={() => setOpen(null)}
                  />
                ) : (
                  <AddSlot
                    kind="asset"
                    cadence={cadence}
                    tag={CADENCE_COPY[cadence].tag}
                    hint={CADENCE_COPY[cadence].hint}
                    onClick={() => openSlot({ kind: "asset", cadence })}
                  />
                )}
              </div>
            );
          })}

          {/* Mission asset — authored on the Mission tab; read-only here. */}
          {mission ? (
            <MissionCard
              title={mission.title}
              area={mission.area}
              termDays={mission.term_days}
              metrics={metricsByHabit[mission.id]}
            />
          ) : (
            <EmptyHint text="Set your Mission habit on the Mission tab" />
          )}
        </div>

        {/* Graduated · holdings shelf — kept with the assets it grew from. */}
        {graduated.length > 0 && (
          <div className="mt-5 border-t border-divider pt-3.5">
            <div className="flex items-baseline justify-between">
              <Kicker as="h3" className="tracking-[0.1em] text-ink">
                Graduated
              </Kicker>
              <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
                {graduated.length}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {graduated.map((g) => (
                <span
                  key={g.id}
                  className="inline-flex items-center gap-1.5 rounded-pill border border-hairline bg-surface px-3 py-1.5 text-[12px] font-medium text-ink"
                >
                  <Check className="h-3.5 w-3.5 shrink-0 text-positive" strokeWidth={2.5} aria-hidden />
                  {g.title}
                </span>
              ))}
            </div>
            <p className="mt-2.5 text-[12px] leading-[1.5] text-ink-soft">
              Automatic now — your long-term position, proof of what you&apos;ve built.
            </p>
          </div>
        )}
      </CollapsibleSection>

      {/* ── Liabilities · paying down ─────────────────────────── */}
      <CollapsibleSection title="Liabilities" summary={liabilitiesSummary}>
        <p className="-mt-0.5 mb-3 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
          Paying down · retire by clean streak
        </p>

        <div className="space-y-2.5">
          {vices.map((v) =>
            editing === v.id ? (
              <EditForm
                key={v.id}
                habit={v}
                onClose={() => setEditing(null)}
                onResult={setAnnounce}
              />
            ) : (
              <LiabilityCard
                key={v.id}
                title={v.title}
                area={v.area}
                metrics={metricsByHabit[v.id]}
                onEdit={() => setEditing(v.id)}
              />
            ),
          )}

          {status.liabilityOpen > 0 &&
            (open?.kind === "liability" ? (
              <SlotForm
                title={title}
                setTitle={setTitle}
                area={area}
                setArea={setArea}
                term={14}
                setTerm={() => {}}
                showTerm={false}
                placeholder="e.g. Doomscrolling"
                error={error}
                submitting={submitting}
                canSubmit={canSubmit}
                onSubmit={submit}
                onCancel={() => setOpen(null)}
              />
            ) : (
              <AddSlot
                kind="liability"
                cadence={null}
                tag="Vice"
                hint="A habit to pay down."
                onClick={() => openSlot({ kind: "liability" })}
              />
            ))}
        </div>
        <p className="mt-3 text-[12px] leading-[1.5] text-ink-soft">
          Mark it paid each day from Home. Miss a day and the counter reopens — gracefully, never punished.
        </p>
      </CollapsibleSection>
      </div>
    </div>
  );
}

// Asset card (handoff §2) — white surface, CategoryBadge + title, the commitment
// term row (DAY n/total + contribution), and a days-done progress track. The
// metrics come from the price engine via getOperatingState (same source as Home).
// Setup-only here: edit + term review; daily logging lives on Home.

// Pencil affordance that opens a habit's edit/details form. 44px target + label.
function EditButton({ title, onEdit }: { title: string; onEdit: () => void }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`Edit ${title}`}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft transition active:scale-95"
    >
      <Pencil className="h-4 w-4" strokeWidth={2} aria-hidden />
    </button>
  );
}

function AssetCard({
  habitId,
  cadence,
  title,
  termDays,
  area,
  metrics,
  onEdit,
  onReplaced,
}: {
  habitId: string;
  cadence: Cadence;
  title: string;
  termDays: number | null;
  area: string | null;
  metrics?: HabitMetrics;
  onEdit: () => void;
  onReplaced: () => void;
}) {
  // Asset "matures by accumulation": the bar fills by days DONE within the term,
  // distinct from the calendar DAY n/total counter. Both come from the engine; a
  // missing metric (engine read failed) leaves the bar empty rather than faking it.
  const daysDone = metrics?.daysDone ?? null;
  const dayOfTerm = metrics?.dayOfTerm ?? null;
  const contribCents = metrics?.contribCents ?? 0;
  const barPct =
    daysDone != null && termDays
      ? Math.max(0, Math.min(100, Math.round((daysDone / termDays) * 100)))
      : 0;

  // The term is a commitment-and-review window: at/near its end, offer the review
  // actions. daysLeft can go ≤0 once the term has elapsed (review is overdue).
  const daysLeft = dayOfTerm != null && termDays ? termDays - dayOfTerm : null;
  const showReview = daysLeft != null && daysLeft <= REVIEW_WINDOW_DAYS;

  return (
    <div className="rounded-card border border-hairline bg-surface p-3.5">
      <div className="flex items-start gap-3">
        <CategoryBadge kind={badgeKindFor("asset", cadence)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold leading-tight text-ink">{title}</p>
          <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
            {CADENCE_COPY[cadence].tag}
            {area ? ` · ${area}` : ""}
          </p>
        </div>
        <EditButton title={title} onEdit={onEdit} />
      </div>

      {termDays ? (
        <div className="mt-3">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
              {termDays}-day term
            </span>
            <div className="flex items-baseline gap-2.5">
              {dayOfTerm != null && (
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
                  Day {dayOfTerm} / {termDays}
                </span>
              )}
              {contribCents !== 0 && (
                <span
                  className={`font-mono text-[11px] font-semibold tabular-nums ${
                    contribCents > 0 ? "text-positive" : "text-danger"
                  }`}
                >
                  {formatSignedDollars(contribCents)}
                </span>
              )}
            </div>
          </div>
          <div className="mt-1.5 h-[5px] overflow-hidden rounded-[3px] bg-divider">
            {/* Fills by days DONE in the term — "matures by accumulation" (handoff §2). */}
            <div className="h-full rounded-[3px] bg-positive transition-[width] duration-300" style={{ width: `${barPct}%` }} />
          </div>
          {daysDone != null && (
            <div className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.1em] text-ink-faint">
              {daysDone} {daysDone === 1 ? "day" : "days"} done
            </div>
          )}
        </div>
      ) : null}

      {showReview && (
        <TermReview habitId={habitId} daysLeft={daysLeft} onReplaced={onReplaced} />
      )}
    </div>
  );
}

// Term-review row (handoff §2) — shown only at/near term end. Renew restarts the
// term; Replace frees the slot (parent re-opens the add form via onReplaced);
// Graduate is a two-tap human confirmation that moves the habit to the shelf.
// Graduation is NEVER automatic — the user must press it.
function TermReview({
  habitId,
  daysLeft,
  onReplaced,
}: {
  habitId: string;
  daysLeft: number;
  onReplaced: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "renew" | "replace" | "graduate">(null);
  const [confirmGrad, setConfirmGrad] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "renew" | "replace" | "graduate") {
    if (busy) return;
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/habits/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ habitId, action }),
      });
      if (!res.ok) throw new Error();
      // Replace frees the slot — open the add form for it before the data refresh.
      if (action === "replace") onReplaced();
      router.refresh();
    } catch {
      setError("Couldn’t update — try again");
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 border-t border-divider pt-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
          Term review · {daysLeft > 0 ? `${daysLeft}d` : "due"}
        </span>
        {error && (
          <span role="alert" className="text-[10px] font-medium text-danger">
            {error}
          </span>
        )}
      </div>
      <div className="mt-2 flex gap-1.5">
        {confirmGrad ? (
          // Two-tap human confirm, with a cancel-out so a mis-tap isn't committed.
          <>
            <ReviewPill ink onClick={() => act("graduate")} busy={busy === "graduate"}>
              Confirm graduate
            </ReviewPill>
            <ReviewPill onClick={() => setConfirmGrad(false)}>Cancel</ReviewPill>
          </>
        ) : (
          <>
            <ReviewPill onClick={() => act("renew")} busy={busy === "renew"}>
              Renew
            </ReviewPill>
            <ReviewPill onClick={() => act("replace")} busy={busy === "replace"}>
              Replace
            </ReviewPill>
            <ReviewPill ink onClick={() => setConfirmGrad(true)}>
              Graduate
            </ReviewPill>
          </>
        )}
      </div>
    </div>
  );
}

// One term-review action pill. `ink` = the filled (Graduate) variant. min-h-11
// keeps the touch target ≥44px.
function ReviewPill({
  ink,
  busy,
  onClick,
  children,
}: {
  ink?: boolean;
  busy?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={cn(
        "min-h-11 flex-1 rounded-pill border px-3 text-[12px] font-semibold transition active:scale-95 disabled:opacity-50",
        ink
          ? "border-transparent bg-accent text-accent-text"
          : "border-hairline bg-surface text-ink-soft",
      )}
    >
      {busy ? "…" : children}
    </button>
  );
}

// Liability card (handoff §2) — warm-red tint, open-ended clean counter. The clean
// streak comes from the price engine (same source as Home); a row of filled
// day-squares trails into "→ OPEN" — no countdown, no "days left". A missing
// metric (engine read failed) shows "—" rather than a fabricated zero.
const SQUARES_CAP = 12; // most recent clean days to render as squares (open-ended).

function LiabilityCard({
  title,
  area,
  metrics,
  onEdit,
}: {
  title: string;
  area: string | null;
  metrics?: HabitMetrics;
  onEdit: () => void;
}) {
  const daysClean = metrics?.daysClean ?? null;
  const filled = daysClean != null ? Math.min(daysClean, SQUARES_CAP) : 0;

  return (
    <div className="rounded-card border border-liability-border bg-liability-bg p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold leading-tight text-ink">{title}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-ink-soft">
            Open counter · retires at a 30-day streak
            {area ? ` · ${area}` : ""}
          </p>
        </div>
        <EditButton title={title} onEdit={onEdit} />
        <div className="shrink-0 text-right">
          <div className="font-mono text-[24px] font-semibold leading-none text-positive tabular-nums">
            {daysClean ?? "—"}
          </div>
          <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
            Days clean
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        {/* Filled day-squares grow with the clean streak; open-ended → no end cap. */}
        <div className="flex items-center gap-1" aria-hidden>
          {Array.from({ length: filled }).map((_, i) => (
            <span key={i} className="h-4 w-4 rounded-[5px] bg-positive" />
          ))}
          <span className="ml-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
            → Open
          </span>
        </div>
      </div>
    </div>
  );
}

// Read-only Mission asset card. The Mission habit is authored and edited on the
// Mission tab; Systems shows it for context only — no add / edit / log here.
function MissionCard({
  title,
  area,
  termDays,
  metrics,
}: {
  title: string;
  area: string | null;
  termDays: number | null;
  metrics?: HabitMetrics;
}) {
  const daysDone = metrics?.daysDone ?? null;
  const barPct =
    daysDone != null && termDays
      ? Math.max(0, Math.min(100, Math.round((daysDone / termDays) * 100)))
      : 0;

  return (
    <div className="rounded-card border border-hairline bg-surface p-3.5">
      <div className="flex items-start gap-3">
        <CategoryBadge kind={badgeKindFor("asset", "mission")} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold leading-tight text-ink">{title}</p>
          <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
            {CADENCE_COPY.mission.tag}
            {area ? ` · ${area}` : ""}
          </p>
        </div>
        <span className="shrink-0 self-center font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
          Managed from Mission
        </span>
      </div>

      {termDays ? (
        <div className="mt-3">
          <div className="h-[5px] overflow-hidden rounded-[3px] bg-divider">
            <div className="h-full rounded-[3px] bg-positive transition-[width] duration-300" style={{ width: `${barPct}%` }} />
          </div>
          {daysDone != null && (
            <div className="mt-1 font-mono text-[8.5px] uppercase tracking-[0.1em] text-ink-faint">
              {daysDone} {daysDone === 1 ? "day" : "days"} done
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function AddSlot({
  kind,
  cadence,
  tag,
  hint,
  onClick,
}: {
  kind: "asset" | "liability";
  cadence: Cadence | null;
  tag: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Add ${tag.toLowerCase()} habit`}
      className="flex min-h-11 w-full items-center gap-3 rounded-card border border-dashed border-hairline px-3.5 py-3 text-left transition active:scale-[0.99]"
    >
      <CategoryBadge kind={badgeKindFor(kind, cadence)} className="opacity-60" />
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
          {tag}
        </span>
        <p className="mt-0.5 text-[13px] font-medium text-ink-soft">{hint}</p>
      </div>
      <span aria-hidden className="ml-1 shrink-0 text-[22px] font-light leading-none text-accent-ink">+</span>
    </button>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-card border border-dashed border-hairline px-3.5 py-3">
      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
        {text}
      </span>
    </div>
  );
}

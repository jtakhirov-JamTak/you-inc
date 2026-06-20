"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { cn, safeUUID } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Kicker } from "@/components/ui/kicker";
import dynamic from "next/dynamic";
import { pillAccentClass, SecondaryButton } from "@/components/ui/button";

// Lazy-load VoiceInput so the audio/recorder code isn't in the initial bundle;
// it only renders inside an opened slot form. Placeholder keeps layout stable.
const VoiceInput = dynamic(
  () => import("@/components/voice-input").then((m) => m.VoiceInput),
  {
    ssr: false,
    loading: () => (
      <div className="h-[96px] rounded-card border border-hairline bg-surface" />
    ),
  },
);
import {
  ASSET_CADENCES,
  rosterStatus,
  type Cadence,
  type RosterSlot,
} from "@/lib/habits/roster";

export interface HabitView {
  id: string;
  kind: "asset" | "liability";
  cadence: Cadence | null;
  area: "health" | "wealth" | "relationships" | null;
  title: string;
  term_days: number | null;
  loggedToday: boolean;
}

// The client's own today + IANA zone, captured at tap time (the authoritative
// "what local day is it for this user right now"). Sent with every log so the
// server buckets it correctly and rejects future dates.
function clientToday(): { localDate: string; tz: string } {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return { localDate, tz };
}

const TERMS = [7, 14, 30, 60] as const;
const AREAS = ["health", "wealth", "relationships"] as const;
const WEEKDAYS = [
  { d: 0, label: "S" },
  { d: 1, label: "M" },
  { d: 2, label: "T" },
  { d: 3, label: "W" },
  { d: 4, label: "T" },
  { d: 5, label: "F" },
  { d: 6, label: "S" },
] as const;
// Full names so the single-letter day toggles aren't ambiguous to screen readers.
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const CADENCE_COPY: Record<Cadence, { tag: string; hint: string }> = {
  morning: { tag: "Morning", hint: "Your one keystone morning habit." },
  daily: { tag: "Daily", hint: "The habit you repeat every day." },
  weekly: { tag: "Weekly", hint: "A recurring weekly commitment." },
};

type OpenSlot = { kind: "asset"; cadence: Cadence } | { kind: "liability" } | null;

// Small chip used for area / term / weekday pickers.
function Chip({
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

export function HabitRoster({ initialHabits }: { initialHabits: HabitView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<OpenSlot>(null);

  // form state
  const [title, setTitle] = useState("");
  const [area, setArea] = useState<(typeof AREAS)[number] | null>(null);
  const [term, setTerm] = useState<(typeof TERMS)[number]>(14);
  const [days, setDays] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slots: RosterSlot[] = initialHabits.map((h) => ({
    kind: h.kind,
    cadence: h.cadence,
  }));
  const status = rosterStatus(slots);

  const assets = initialHabits.filter((h) => h.kind === "asset");
  const vices = initialHabits.filter((h) => h.kind === "liability");

  function resetForm() {
    setTitle("");
    setArea(null);
    setTerm(14);
    setDays([]);
    setError(null);
  }

  function openSlot(slot: OpenSlot) {
    resetForm();
    setOpen(slot);
  }

  function toggleDay(d: number) {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );
  }

  const isWeekly = open?.kind === "asset" && open.cadence === "weekly";
  const canSubmit =
    !!title.trim() && !submitting && (!isWeekly || days.length > 0);

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
            recurrence:
              open.cadence === "weekly"
                ? { type: "weekdays", days }
                : undefined,
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
    <div className="space-y-4">
      {/* ── Assets ───────────────────────────────────────────── */}
      <Card className="p-5">
        <Kicker as="h2">Assets · building</Kicker>
        <p className="mt-2 text-[13px] font-medium leading-[1.5] text-ink-soft">
          One morning, one daily, one weekly. Each compounds your value.
        </p>

        <div className="mt-4 space-y-2.5">
          {ASSET_CADENCES.map((cadence) => {
            const held = assets.find((h) => h.cadence === cadence);
            const formOpen = open?.kind === "asset" && open.cadence === cadence;
            return (
              <div key={cadence}>
                {held ? (
                  <FilledRow
                    habitId={held.id}
                    kind="asset"
                    logged={held.loggedToday}
                    tag={CADENCE_COPY[cadence].tag}
                    title={held.title}
                    sub={held.term_days ? `${held.term_days}-day term` : null}
                    area={held.area}
                  />
                ) : formOpen ? (
                  <SlotForm
                    title={title}
                    setTitle={setTitle}
                    area={area}
                    setArea={setArea}
                    term={term}
                    setTerm={setTerm}
                    showTerm
                    isWeekly={cadence === "weekly"}
                    days={days}
                    toggleDay={toggleDay}
                    placeholder={`e.g. ${cadence === "morning" ? "Meditate 10 min" : cadence === "weekly" ? "Deep review" : "Workout"}`}
                    error={error}
                    submitting={submitting}
                    canSubmit={canSubmit}
                    onSubmit={submit}
                    onCancel={() => setOpen(null)}
                  />
                ) : (
                  <AddSlot
                    tag={CADENCE_COPY[cadence].tag}
                    hint={CADENCE_COPY[cadence].hint}
                    onClick={() => openSlot({ kind: "asset", cadence })}
                  />
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* ── Liabilities ──────────────────────────────────────── */}
      <Card className="p-5">
        <Kicker as="h2">Liabilities · paying down</Kicker>
        <p className="mt-2 text-[13px] font-medium leading-[1.5] text-ink-soft">
          Two vices to retire. A clean streak pays them down.
        </p>

        <div className="mt-4 space-y-2.5">
          {vices.map((v) => (
            <FilledRow
              key={v.id}
              habitId={v.id}
              kind="liability"
              logged={v.loggedToday}
              tag="Vice"
              title={v.title}
              sub={null}
              area={v.area}
            />
          ))}

          {Array.from({ length: status.liabilityOpen }).map((_, i) => {
            // Only the first open vice slot can be expanded at a time.
            const formOpen = open?.kind === "liability" && i === 0;
            return formOpen ? (
              <SlotForm
                key={`open-${i}`}
                title={title}
                setTitle={setTitle}
                area={area}
                setArea={setArea}
                term={14}
                setTerm={() => {}}
                showTerm={false}
                isWeekly={false}
                days={[]}
                toggleDay={() => {}}
                placeholder="e.g. Doomscrolling"
                error={error}
                submitting={submitting}
                canSubmit={canSubmit}
                onSubmit={submit}
                onCancel={() => setOpen(null)}
              />
            ) : i === 0 ? (
              <AddSlot
                key={`open-${i}`}
                tag="Vice"
                hint="A habit to pay down."
                onClick={() => openSlot({ kind: "liability" })}
              />
            ) : (
              <EmptyHint key={`open-${i}`} text="Second vice slot" />
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function FilledRow({
  habitId,
  kind,
  logged,
  tag,
  title,
  sub,
  area,
}: {
  habitId: string;
  kind: "asset" | "liability";
  logged: boolean;
  tag: string;
  title: string;
  sub: string | null;
  area: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[14px] border border-hairline bg-surface-tint px-4 py-3">
      <div className="min-w-0">
        <span className="font-mono text-[10px] uppercase tracking-[1.3px] text-ink-soft">
          {tag}
          {area ? ` · ${area}` : ""}
          {sub ? ` · ${sub}` : ""}
        </span>
        <p className="mt-0.5 truncate text-[14px] font-semibold text-ink">{title}</p>
      </div>
      <LogToggle habitId={habitId} kind={kind} logged={logged} />
    </div>
  );
}

// Tap-to-log control. Asset: "Mark done" today (green when done). Liability:
// "Log slip" today (danger when slipped). A second tap undoes the day's log.
// The natural-key idempotency on (user, habit, local_date) makes a double-tap a
// no-op; router.refresh() reconciles the server's logged state after each tap.
function LogToggle({
  habitId,
  kind,
  logged,
}: {
  habitId: string;
  kind: "asset" | "liability";
  logged: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function tap() {
    if (pending) return;
    setPending(true);
    setFailed(false);
    const { localDate, tz } = clientToday();
    try {
      const res = await fetch("/api/habits/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          habitId,
          localDate,
          occurredTz: tz,
          sourceSessionId: safeUUID(),
          action: logged ? "undo" : "log",
        }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  const isAsset = kind === "asset";
  const onLabel = isAsset ? "Done today" : "Slipped today";
  const offLabel = isAsset ? "Mark done" : "Log slip";
  const onTone = isAsset
    ? "bg-accent text-accent-text border-transparent"
    : "bg-danger/15 text-danger border-transparent";

  const label = failed
    ? "Couldn’t save — tap to retry"
    : logged
      ? `${onLabel}, tap to undo`
      : offLabel;

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

function AddSlot({
  tag,
  hint,
  onClick,
}: {
  tag: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Add ${tag.toLowerCase()} habit`}
      className="flex w-full items-center justify-between rounded-[14px] border border-dashed border-hairline px-4 py-3 text-left transition active:scale-[0.99]"
    >
      <div>
        <span className="font-mono text-[10px] uppercase tracking-[1.3px] text-ink-soft">
          {tag}
        </span>
        <p className="mt-0.5 text-[13px] font-medium text-ink-soft">{hint}</p>
      </div>
      <span aria-hidden className="ml-3 shrink-0 text-[22px] font-light leading-none text-accent-ink">+</span>
    </button>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-[14px] border border-dashed border-hairline px-4 py-3">
      <span className="font-mono text-[10px] uppercase tracking-[1.3px] text-ink-soft">
        {text}
      </span>
    </div>
  );
}

function SlotForm({
  title,
  setTitle,
  area,
  setArea,
  term,
  setTerm,
  showTerm,
  isWeekly,
  days,
  toggleDay,
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
  isWeekly: boolean;
  days: number[];
  toggleDay: (d: number) => void;
  placeholder: string;
  error: string | null;
  submitting: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-[14px] border border-hairline bg-surface-tint p-4">
      <VoiceInput
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

      {isWeekly && (
        <div className="mt-3">
          <Kicker>Which days</Kicker>
          <div className="mt-1.5 flex gap-1.5">
            {WEEKDAYS.map((w, i) => (
              <button
                key={i}
                type="button"
                aria-pressed={days.includes(w.d)}
                aria-label={WEEKDAY_NAMES[w.d]}
                onClick={() => toggleDay(w.d)}
                className={cn(
                  // h-11 (44px tall) flex-1 — full-width pills keep the touch
                  // target ≥44px high while fitting all 7 in the card row.
                  "h-11 flex-1 rounded-[12px] border text-[13px] font-semibold transition active:scale-95",
                  days.includes(w.d)
                    ? "border-transparent bg-accent text-accent-text"
                    : "border-hairline bg-surface text-ink-soft",
                )}
              >
                {w.label}
              </button>
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

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Lock } from "lucide-react";
import { cn, safeUUID } from "@/lib/utils";
import { Kicker } from "@/components/ui/kicker";
import { CategoryBadge, badgeKindFor } from "@/components/ui/category-badge";
import { TextArea } from "@/components/ui/text-area";
import { pillAccentClass, SecondaryButton } from "@/components/ui/button";
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
}

// A 'YYYY-MM-DD' rendered as a short, screen-reader-friendly label. Parsed at noon
// so the calendar date never drifts across the local-midnight boundary.
function dayLabel(date: string, today: string): { short: string; full: string } {
  const dt = new Date(`${date}T12:00:00`);
  const full = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(dt);
  if (date === today) return { short: "Today", full: `Today, ${full}` };
  return {
    short: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(dt),
    full,
  };
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

export function HabitRoster({
  initialHabits,
  days: windowDays,
  today,
  loggedByDate,
  lockedDates,
}: {
  initialHabits: HabitView[];
  days: string[];
  today: string;
  loggedByDate: Record<string, string[]>;
  lockedDates: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<OpenSlot>(null);

  // Which day the roster is checking in for. Lives here (not in a child) so a
  // router.refresh() after a tap preserves the picker's position.
  const [selectedDate, setSelectedDate] = useState<string>(today);
  // Visually-hidden live status of the last log action (for screen readers).
  const [announce, setAnnounce] = useState("");

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

  const loggedSet = new Set(loggedByDate[selectedDate] ?? []);
  const isLocked = lockedDates.includes(selectedDate);
  const selectedLabel = dayLabel(selectedDate, today);
  // Shared props every LogToggle on this screen needs for the selected day.
  const toggleCtx = {
    localDate: selectedDate,
    locked: isLocked,
    dateLabel: selectedLabel.short,
    onResult: setAnnounce,
  };

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
    <div className="space-y-7 pb-10">
      {/* Visually-hidden live region — announces each check-in result. */}
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      {/* ── Check-in day picker — today + 6 days back ─────────── */}
      <DayPicker
        days={windowDays}
        today={today}
        selected={selectedDate}
        lockedDates={lockedDates}
        onSelect={setSelectedDate}
      />
      {isLocked && (
        <p className="-mt-4 px-0.5 text-[12px] leading-[1.5] text-ink-soft">
          {selectedLabel.short} is in a settled week — its check-ins are locked.
        </p>
      )}

      {/* ── Assets · building ─────────────────────────────────── */}
      <section className="mt-7">
        <div className="flex items-baseline justify-between px-0.5">
          <Kicker as="h2" className="tracking-[0.1em] text-positive">
            Assets · building
          </Kicker>
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
            Mature by accumulation
          </span>
        </div>

        <div className="mt-3 space-y-2.5">
          {ASSET_CADENCES.map((cadence) => {
            const held = assets.find((h) => h.cadence === cadence);
            const formOpen = open?.kind === "asset" && open.cadence === cadence;
            return (
              <div key={cadence}>
                {held ? (
                  <AssetCard
                    habitId={held.id}
                    logged={loggedSet.has(held.id)}
                    cadence={cadence}
                    title={held.title}
                    termDays={held.term_days}
                    area={held.area}
                    {...toggleCtx}
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
        </div>
      </section>

      {/* ── Liabilities · paying down ─────────────────────────── */}
      <section>
        <div className="flex items-baseline justify-between px-0.5">
          <Kicker as="h2" className="tracking-[0.1em] text-danger">
            Liabilities · paying down
          </Kicker>
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
            Retire by clean streak
          </span>
        </div>

        <div className="mt-3 space-y-2.5">
          {vices.map((v) => (
            <LiabilityCard
              key={v.id}
              habitId={v.id}
              logged={loggedSet.has(v.id)}
              title={v.title}
              area={v.area}
              {...toggleCtx}
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
                kind="liability"
                cadence={null}
                tag="Vice"
                hint="A habit to pay down."
                onClick={() => openSlot({ kind: "liability" })}
              />
            ) : (
              <EmptyHint key={`open-${i}`} text="Second vice slot" />
            );
          })}
        </div>
        <p className="mt-3 px-0.5 text-[12px] leading-[1.5] text-ink-soft">
          Mark it paid each day. Miss a day and the counter reopens — gracefully, never punished.
        </p>
      </section>
    </div>
  );
}

// Asset card (handoff §2) — white surface, CategoryBadge + title, the commitment
// term row, and a days-done progress track. Days-done / day-of-term aren't in the
// page's fetched shape, so the bar renders as an empty track (no fabricated fill)
// and the "DAY n / total" counter is omitted until that data is wired.
// Shared props every LogToggle needs to log the selected day.
interface ToggleCtx {
  localDate: string;
  locked: boolean;
  dateLabel: string;
  onResult: (msg: string) => void;
}

function AssetCard({
  habitId,
  logged,
  cadence,
  title,
  termDays,
  area,
  ...ctx
}: {
  habitId: string;
  logged: boolean;
  cadence: Cadence;
  title: string;
  termDays: number | null;
  area: string | null;
} & ToggleCtx) {
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
        <LogToggle habitId={habitId} kind="asset" logged={logged} {...ctx} />
      </div>

      {termDays ? (
        <div className="mt-3">
          <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
            {termDays}-day term
          </div>
          <div className="mt-1.5 h-[5px] overflow-hidden rounded-[3px] bg-divider">
            {/* Days-done fill is wired once the count is fetched; empty for now. */}
            <div className="h-full rounded-[3px] bg-positive" style={{ width: "0%" }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Liability card (handoff §2) — warm-red tint, open-ended clean counter. The
// days-clean streak isn't in the page's fetched shape, so the counter renders as
// an open "—" placeholder (no fabricated number) and trails into "→ OPEN".
function LiabilityCard({
  habitId,
  logged,
  title,
  area,
  ...ctx
}: {
  habitId: string;
  logged: boolean;
  title: string;
  area: string | null;
} & ToggleCtx) {
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
        <div className="shrink-0 text-right">
          <div className="font-mono text-[24px] font-semibold leading-none text-positive tabular-nums">
            —
          </div>
          <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
            Days clean
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        {/* Filled day-squares fill in as the clean streak grows; open-ended. */}
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
          → Open
        </span>
        <div className="ml-auto">
          <LogToggle habitId={habitId} kind="liability" logged={logged} {...ctx} />
        </div>
      </div>
    </div>
  );
}

// Tap-to-log control for the SELECTED day. Asset: "Mark done"; liability: "Mark
// paid" (the affirmative-good action — there is no slip button). Both turn accent
// when logged. A second tap undoes the day's log. The natural-key idempotency on
// (user, habit, local_date) makes a double-tap a no-op; router.refresh() reconciles
// the server's logged state after each tap. A day in a settled week renders locked.
function LogToggle({
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
    // localDate is the SELECTED day; tz is still captured client-side for the
    // server's future-date guard and occurred_tz.
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

// Horizontal 7-day check-in selector (today rightmost). A day in a settled week is
// disabled with a lock glyph. Scrolls horizontally on very narrow screens.
function DayPicker({
  days,
  today,
  selected,
  lockedDates,
  onSelect,
}: {
  days: string[];
  today: string;
  selected: string;
  lockedDates: string[];
  onSelect: (d: string) => void;
}) {
  return (
    <div className="-mx-[18px] overflow-x-auto px-[18px]">
      <div className="flex gap-1.5">
        {days.map((d) => {
          const dt = new Date(`${d}T12:00:00`);
          const dayNum = new Intl.DateTimeFormat(undefined, { day: "numeric" }).format(dt);
          const { short, full } = dayLabel(d, today);
          const isSelected = d === selected;
          const isLocked = lockedDates.includes(d);
          return (
            <button
              key={d}
              type="button"
              disabled={isLocked}
              aria-pressed={isSelected}
              aria-label={isLocked ? `${full}, week settled — locked` : full}
              onClick={() => onSelect(d)}
              className={cn(
                "flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-[12px] border px-2 py-1.5 transition active:scale-95",
                isSelected
                  ? "border-transparent bg-accent text-accent-text"
                  : "border-hairline bg-surface text-ink-soft",
                isLocked && "opacity-50",
              )}
            >
              <span className="font-mono text-[9px] uppercase tracking-[0.08em]">{short}</span>
              <span className="flex items-center gap-0.5 text-[14px] font-semibold tabular-nums">
                {dayNum}
                {isLocked && <Lock className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />}
              </span>
            </button>
          );
        })}
      </div>
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

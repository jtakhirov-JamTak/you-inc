import { getAuthUser, createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Kicker } from "@/components/ui/kicker";
import { addDays, localDateInTz } from "@/lib/price/dates";
import { getOperatingState } from "@/lib/price/runner";
import { HabitRoster, type HabitView, type HabitMetrics } from "./habit-roster";

// How many days back the check-in picker offers (today + 6 prior).
const WINDOW_DAYS = 7;

// Habits — the balance sheet (spec §Habits). The roster has a fixed shape:
// 1 morning + 1 daily + 1 weekly asset + 2 vices. Creation enforces it
// server-side (POST /api/habits → validateRosterAddition).
export default async function HabitsPage() {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  // The user's "today" (their timezone) anchors the 7-day check-in window. The
  // client re-derives its own today/tz at tap time; this is just the initial
  // display state, reconciled by router.refresh() after each tap.
  const { data: settings } = await supabase
    .from("user_settings")
    .select("timezone")
    .eq("user_id", user.id)
    .maybeSingle();
  let today: string;
  try {
    today = localDateInTz(new Date(), settings?.timezone || "UTC");
  } catch {
    today = localDateInTz(new Date(), "UTC");
  }

  // Last 7 local days, oldest → newest (today rightmost).
  const days = Array.from({ length: WINDOW_DAYS }, (_, i) =>
    addDays(today, -(WINDOW_DAYS - 1 - i)),
  );
  const windowStart = days[0];

  // Live per-position metrics (DAY n/total, days-done, days-clean, contribution)
  // come from the SAME engine pass Home uses, so the two screens can't diverge.
  // Non-fatal: a failure just falls back to the cards' neutral placeholders.
  const operatingPromise = getOperatingState(user.id).catch(() => null);

  const [{ data: habits, error }, { data: windowLogs }, { data: settledRows }] =
    await Promise.all([
      supabase
        .from("habits")
        .select("id, kind, cadence, area, title, term_days, recurrence_rule")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: true }),
      // Logs across the whole window so each day's marked-state is known.
      supabase
        .from("habit_logs")
        .select("habit_id, local_date")
        .eq("user_id", user.id)
        .gte("local_date", windowStart)
        .lte("local_date", today),
      // Settled weeks freeze their days (migration-0011 write lock) — a backfill
      // into one would 409, so we disable those days in the picker.
      supabase
        .from("price_ledger")
        .select("occurred_at")
        .eq("user_id", user.id)
        .eq("event_type", "habit_week_settled"),
    ]);

  // habitIds already logged per local_date.
  const loggedByDate: Record<string, string[]> = {};
  for (const l of windowLogs ?? []) {
    (loggedByDate[l.local_date] ??= []).push(l.habit_id);
  }

  // A window-day is locked if it lands in any settled week's frozen range
  // [weekEnd-6, weekEnd] — occurred_at is weekEnd at noon UTC (mirrors 0011). ISO
  // dates compare lexically, so string comparison is chronological.
  const lockedDates = days.filter((d) =>
    (settledRows ?? []).some((r) => {
      const weekEnd = String(r.occurred_at).slice(0, 10);
      return d >= addDays(weekEnd, -6) && d <= weekEnd;
    }),
  );

  const views: HabitView[] = (habits ?? []) as HabitView[];

  // Index engine metrics by habit id for the roster cards.
  const operatingState = await operatingPromise;
  const metricsByHabit: Record<string, HabitMetrics> = {};
  for (const p of operatingState?.positions ?? []) {
    metricsByHabit[p.habitId] = {
      dayOfTerm: p.dayOfTerm,
      daysDone: p.daysDone,
      daysClean: p.daysClean,
      contribCents: p.contribCents,
    };
  }

  return (
    <div className="mx-auto min-h-full max-w-[460px] px-[18px] pt-3">
      {/* Header — "The Balance Sheet" (handoff §2) */}
      <header className="pt-1">
        <h1 className="font-display text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] text-ink">
          Habits
        </h1>
        <p className="mt-1.5 text-[13px] font-medium leading-[1.4] text-ink-soft">
          Assets compound. Liabilities retire on a clean streak.
        </p>
      </header>

      {error ? (
        <div className="mt-6 rounded-card border border-liability-border bg-liability-bg p-5">
          <Kicker as="h2">Couldn&apos;t load your habits</Kicker>
          <p className="mt-2 text-[14px] font-medium leading-[1.5] text-ink-soft">
            Refresh in a moment — nothing was lost.
          </p>
        </div>
      ) : (
        <HabitRoster
          initialHabits={views}
          days={days}
          today={today}
          loggedByDate={loggedByDate}
          lockedDates={lockedDates}
          metricsByHabit={metricsByHabit}
        />
      )}
    </div>
  );
}

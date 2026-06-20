import { getAuthUser, createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Kicker } from "@/components/ui/kicker";
import { localDateInTz } from "@/lib/price/dates";
import { HabitRoster, type HabitView } from "./habit-roster";

// Habits — the balance sheet (spec §Habits). The roster has a fixed shape:
// 1 morning + 1 daily + 1 weekly asset + 2 vices. Creation enforces it
// server-side (POST /api/habits → validateRosterAddition).
export default async function HabitsPage() {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  // The user's "today" (their timezone) to show which rows are already logged.
  // The client re-derives its own today/tz at tap time; this is just the initial
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

  const [{ data: habits, error }, { data: todayLogs }] = await Promise.all([
    supabase
      .from("habits")
      .select("id, kind, cadence, area, title, term_days")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
    supabase
      .from("habit_logs")
      .select("habit_id")
      .eq("user_id", user.id)
      .eq("local_date", today),
  ]);

  const loggedToday = new Set((todayLogs ?? []).map((l) => l.habit_id));
  const views: HabitView[] = (habits ?? []).map((h) => ({
    ...h,
    loggedToday: loggedToday.has(h.id),
  })) as HabitView[];

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
        <HabitRoster initialHabits={views} />
      )}
    </div>
  );
}

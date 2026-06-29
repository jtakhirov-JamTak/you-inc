import { getAuthUser, createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { Kicker } from "@/components/ui/kicker";
import { getOperatingState } from "@/lib/price/runner";
import { HabitRoster, type HabitView, type HabitMetrics, type GraduatedView } from "./habit-roster";
import { DecisionMaking, type DecisionToolsView } from "./decision-tools";

// Systems — setup only. The roster has a fixed shape: 1 morning + 1 evening +
// 1 mission asset + 1 vice. Creation enforces it server-side
// (POST /api/habits → validateRosterAddition). Daily logging lives on Home.
export default async function HabitsPage() {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  // Live per-position metrics (DAY n/total, days-done, days-clean, contribution)
  // come from the SAME engine pass Home uses, so the two screens can't diverge.
  // Non-fatal: a failure just falls back to the cards' neutral placeholders.
  const operatingPromise = getOperatingState(user.id).catch((err) => {
    // Non-fatal (cards fall back to neutral), but settlement books the permanent
    // ledger — capture so a silent failure on this read path isn't invisible.
    Sentry.captureException(err, { tags: { area: "price", kind: "habits_operating_state_failed" } });
    return null;
  });

  const [
    { data: habits, error: habitsError },
    { data: graduatedRows },
    { data: decisionRow },
  ] = await Promise.all([
      supabase
        .from("habits")
        .select("id, kind, cadence, area, title, term_days")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: true }),
      // The graduated holdings shelf — newest first (handoff §Habits/§3).
      supabase
        .from("graduated_habits")
        .select("id, title, area, graduated_on")
        .eq("user_id", user.id)
        .order("graduated_on", { ascending: false }),
      // Decision Making tools — the user's single editable row (may be absent).
      supabase
        .from("decision_tools")
        .select("meditation, protocol, eis_do, eis_decide, eis_delegate, eis_delete")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

  // .error before data: the habits roster is correctness-critical — a transient
  // error shows the load-error card rather than a wrong (empty) partial.
  // graduated/decision are display-only → soft-null ok.
  const error = habitsError;

  // Decision Making tools default to empty strings (a fresh user has no row).
  const decisionTools: DecisionToolsView = {
    meditation: decisionRow?.meditation ?? "",
    protocol: decisionRow?.protocol ?? "",
    eisDo: decisionRow?.eis_do ?? "",
    eisDecide: decisionRow?.eis_decide ?? "",
    eisDelegate: decisionRow?.eis_delegate ?? "",
    eisDelete: decisionRow?.eis_delete ?? "",
  };

  const views: HabitView[] = (habits ?? []) as HabitView[];
  const graduated: GraduatedView[] = (graduatedRows ?? []) as GraduatedView[];

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
    <div className="mx-auto min-h-full max-w-[460px] px-[18px] pt-3 pb-12">
      {/* Header — "The Balance Sheet" (handoff §2) */}
      <header className="pt-1">
        <h1 className="font-display text-[24px] font-extrabold leading-none tracking-[-0.02em] text-ink">
          Systems
        </h1>
        <p className="mt-1 text-[12px] font-medium text-ink-soft">
          Set up the habits you run on. Mark them done each day from Home.
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
          metricsByHabit={metricsByHabit}
          graduated={graduated}
        />
      )}

      {/* Decision Making (Regulation) — independent of the habit roster. */}
      <DecisionMaking tools={decisionTools} />
    </div>
  );
}

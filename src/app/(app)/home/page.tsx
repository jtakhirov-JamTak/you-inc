import { getAuthUser, createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { Kicker } from "@/components/ui/kicker";
import { getOperatingState } from "@/lib/price/runner";
import { localDateInTz } from "@/lib/price/dates";
import { formatDollars, formatSignedDollars } from "@/lib/utils";
import { RegionMap, type RegionView } from "./region-map";
import { TodayHabits, type TodayHabitView } from "./today-habits";
import { ActiveSprint } from "./active-sprint";
import { PendingSettlement } from "./pending-settlement";

// Home — the RPG map + daily tracking hub. The operating value (the real,
// server-derived number from getOperatingState) is kept but demoted to one small
// mono line; the hero is three leveling regions (Health / Wealth / Relationships)
// fed by each area's cumulative contribution. Below it, the day's habit check-ins
// and the active sprint live so Home is the single place you track from.

type Area = "health" | "wealth" | "relationships";
const REGIONS: { area: Area; label: string }[] = [
  { area: "health", label: "Health" },
  { area: "wealth", label: "Wealth" },
  { area: "relationships", label: "Relationships" },
];

export default async function HomePage() {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  // getOperatingState runs under the service role (bypasses RLS): pass the
  // AUTHENTICATED user's id only. It also settles any elapsed weeks first.
  let state: Awaited<ReturnType<typeof getOperatingState>> | null = null;
  try {
    state = await getOperatingState(user.id);
  } catch (err) {
    // The fallback UI is correct for the user, but settlement touches the
    // irreversible price_ledger — a silent failure here must page us, not vanish.
    Sentry.captureException(err, { tags: { area: "price", kind: "home_operating_state_failed" } });
    state = null;
  }

  // Tracking data Home needs in addition to the engine state: the user's timezone
  // (to compute their "today"), the active roster, and today's logs. The region
  // levels now come from the engine state (state.regionLevels) — no separate board
  // read here. The client trackers re-derive their own today/tz at tap time; this is
  // just the initial display.
  let unavailable = state == null;
  let habitViews: TodayHabitView[] = [];
  let loggedToday: string[] = [];

  if (state) {
    const supabase = await createClient();
    const { data: settings, error: settingsErr } = await supabase
      .from("user_settings")
      .select("timezone")
      .eq("user_id", user.id)
      .maybeSingle();
    if (settingsErr) {
      unavailable = true;
    } else {
      let today: string;
      try {
        today = localDateInTz(new Date(), settings?.timezone || "UTC");
      } catch {
        today = localDateInTz(new Date(), "UTC");
      }

      const [habitsRes, logsRes] = await Promise.all([
        supabase
          .from("habits")
          .select("id, kind, cadence, area, title")
          .eq("user_id", user.id)
          .eq("status", "active")
          .order("created_at", { ascending: true }),
        supabase
          .from("habit_logs")
          .select("habit_id")
          .eq("user_id", user.id)
          .eq("local_date", today),
      ]);

      // .error before data on each correctness-relevant read — a transient failure
      // must surface the "unavailable" treatment, not a wrong empty roster.
      if (habitsRes.error || logsRes.error) {
        unavailable = true;
      } else {
        habitViews = (habitsRes.data ?? []).map((h) => ({
          habitId: h.id,
          kind: h.kind as "asset" | "liability",
          cadence: h.cadence,
          area: h.area,
          title: h.title,
        }));
        loggedToday = (logsRes.data ?? []).map((l) => l.habit_id);
      }
    }
  }

  if (!state || unavailable) {
    return (
      <div className="mx-auto min-h-full max-w-[460px] px-[18px] pt-3">
        <HomeHeader />
        <div className="mt-6 rounded-card border border-liability-border bg-liability-bg p-5">
          <Kicker as="h2">Value unavailable</Kicker>
          <p className="mt-2 text-[14px] font-medium leading-[1.5] text-ink-soft">
            We couldn&apos;t read your operating value just now. Refresh in a moment — nothing was lost.
          </p>
        </div>
      </div>
    );
  }

  // Region levels are engine-derived (state.regionLevels: settled per-area
  // contributions + this week's provisional + the active sprint's unrealized return).
  // Home only maps them to the display view + attaches the active-sprint pill.
  const active = state.sprints.active;
  const regions: RegionView[] = REGIONS.map(({ area, label }) => {
    const sprintActive =
      active && active.area === area && active.dayOfTerm != null
        ? { dayOfTerm: active.dayOfTerm, termDays: active.termDays }
        : null;
    return { area, label, levelCents: state.regionLevels[area], sprintActive };
  });

  return (
    <div className="mx-auto min-h-full max-w-[460px] px-[18px] pt-3 pb-12">
      <HomeHeader />

      {/* Operating value — kept, but demoted to one small mono line (no chart). */}
      <div className="mt-4 flex items-baseline gap-2 px-0.5">
        <span className="font-mono text-[15px] font-semibold tabular-nums text-ink">
          {formatDollars(state.displayedCents)}
        </span>
        <span
          className={`font-mono text-[11px] font-semibold tabular-nums ${
            state.weekDeltaCents > 0 ? "text-positive" : "text-ink-soft"
          }`}
        >
          {formatSignedDollars(state.weekDeltaCents)} wk
        </span>
      </div>

      {/* Grace-window card — only on the single day after a week closes, while it's
          still editable and settling tonight. Null the rest of the time. */}
      {state.pendingSettlement && (
        <PendingSettlement
          weekEnd={state.pendingSettlement.weekEnd}
          markCents={state.pendingSettlement.markCents}
        />
      )}

      <RegionMap regions={regions} />

      <TodayHabits habits={habitViews} loggedToday={loggedToday} />

      <ActiveSprint sprint={state.sprints.active} queued={state.sprints.queued} />
    </div>
  );
}

function HomeHeader() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-ink font-mono text-[14px] font-bold text-accent-text">
        Y
      </span>
      <div className="leading-tight">
        <h1 className="text-[13.5px] font-bold text-ink">You, Inc.</h1>
        <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-muted">$YOU · Privately held</div>
      </div>
    </div>
  );
}

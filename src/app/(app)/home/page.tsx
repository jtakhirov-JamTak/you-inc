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

// Read a cents value out of a board_meetings.area_contributions Json map for one
// area, tolerating the loose Json type (unknown keys / non-number values → 0).
function areaCents(contrib: unknown, area: Area): number {
  if (contrib == null || typeof contrib !== "object") return 0;
  const v = (contrib as Record<string, unknown>)[area];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

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
  // (to compute their "today"), the active roster, today's logs, and the cumulative
  // per-area contributions from settled board statements. The client trackers
  // re-derive their own today/tz at tap time; this is just the initial display.
  let unavailable = state == null;
  let habitViews: TodayHabitView[] = [];
  let loggedToday: string[] = [];
  let boardRows: { area_contributions: unknown }[] = [];

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

      const [habitsRes, logsRes, boardRes] = await Promise.all([
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
        // Cumulative per-area contribution from every settled week's statement.
        supabase
          .from("board_meetings")
          .select("area_contributions")
          .eq("user_id", user.id),
      ]);

      // .error before data on each correctness-relevant read — a transient failure
      // must surface the "unavailable" treatment, not a wrong empty roster/$0 map.
      if (habitsRes.error || logsRes.error || boardRes.error) {
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
        boardRows = (boardRes.data ?? []) as { area_contributions: unknown }[];
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

  // Per-region cumulative cents = settled board statements (summed per area) PLUS
  // the current week's provisional: each position's contribCents grouped by area,
  // AND the active sprint's unrealized return on its target region. Positions/sprints
  // with no area are unattributed → excluded from the 3 regions. The active sprint's
  // realized payoff hands off to the settled side at close (when its week settles),
  // so there's no double-count — it's provisional while open, settled once closed.
  const provisionalByArea = new Map<Area, number>();
  for (const p of state.positions) {
    const a = p.area as Area | null;
    if (a === "health" || a === "wealth" || a === "relationships") {
      provisionalByArea.set(a, (provisionalByArea.get(a) ?? 0) + p.contribCents);
    }
  }
  const active = state.sprints.active;
  if (active && (active.area === "health" || active.area === "wealth" || active.area === "relationships")) {
    const a = active.area as Area;
    provisionalByArea.set(a, (provisionalByArea.get(a) ?? 0) + (active.unrealizedReturnCents ?? 0));
  }
  const regions: RegionView[] = REGIONS.map(({ area, label }) => {
    const settled = boardRows.reduce((sum, r) => sum + areaCents(r.area_contributions, area), 0);
    const levelCents = settled + (provisionalByArea.get(area) ?? 0);
    const sprintActive =
      active && active.area === area && active.dayOfTerm != null
        ? { dayOfTerm: active.dayOfTerm, termDays: active.termDays }
        : null;
    return { area, label, levelCents, sprintActive };
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

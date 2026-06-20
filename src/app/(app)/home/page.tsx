import { getAuthUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { StormBackground } from "@/components/brand/StormBackground";
import { Card } from "@/components/ui/card";
import { Kicker } from "@/components/ui/kicker";
import { getOperatingState } from "@/lib/price/runner";
import { formatDollars, formatSignedDollars } from "@/lib/utils";

// Home — the portfolio (spec §Home, fixed layout). The operating value is the
// REAL, server-derived number: getOperatingState folds the append-only
// price_ledger (realized) plus the current week's provisional mark, settling any
// elapsed weeks first. The client never computes the authoritative value.
//
// What is real today: the operating value and the current week's movement.
// Deferred (no data source yet, honest placeholders below): the trend chart and
// the day/day delta both need the daily snapshot store (Home/Board work, not the
// settlement runner); the Positions list and active-sprint card fill in once the
// habit- and sprint-creation flows land later in M3.
export default async function HomePage() {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  // getOperatingState runs under the service role (bypasses RLS), so the caller
  // contract is: pass the AUTHENTICATED user's id — never a client value.
  let state: Awaited<ReturnType<typeof getOperatingState>> | null = null;
  try {
    state = await getOperatingState(user.id);
  } catch {
    // A transient read failure must not render the baseline as if it were real.
    state = null;
  }

  if (!state) {
    return (
      <div className="relative min-h-full px-5 pt-4 pb-32">
        <StormBackground />
        <div className="mb-6 pt-2">
          <Kicker>You, Inc. · $YOU — privately held</Kicker>
        </div>
        <Card className="p-5" variant="warm">
          <Kicker as="h2">Value unavailable</Kicker>
          <p className="mt-2 text-[14px] font-medium leading-[1.5] text-ink-soft">
            We couldn&apos;t read your operating value just now. Refresh in a
            moment — nothing was lost.
          </p>
        </Card>
      </div>
    );
  }

  const weekDelta = state.provisionalCents; // current week's unbooked movement
  const deltaTone =
    weekDelta > 0 ? "text-positive" : weekDelta < 0 ? "text-danger" : "text-ink-soft";
  const arrow = weekDelta > 0 ? "▲" : weekDelta < 0 ? "▼" : "·";

  return (
    <div className="relative min-h-full px-5 pt-4 pb-32">
      <StormBackground />

      {/* Header + operating value */}
      <div className="mb-6 pt-2">
        <Kicker>You, Inc. · $YOU — privately held</Kicker>
        <h1
          className="mt-3 font-display text-[44px] font-medium leading-[1.05] text-ink tabular-nums"
          style={{ letterSpacing: "-1.2px" }}
        >
          {formatDollars(state.displayedCents)}
        </h1>

        {/* Deltas on the fold: Week/Week (primary, real) · Day/Day (secondary,
            deferred until the daily snapshot store exists). */}
        <div className="mt-2 flex items-baseline gap-3 text-[14px] font-medium">
          <span className={`${deltaTone} tabular-nums`}>
            {arrow} {formatSignedDollars(weekDelta)}{" "}
            <span className="text-ink-soft">this week</span>
          </span>
          <span className="text-ink-muted">· — today</span>
        </div>
      </div>

      {/* Trend chart — begins once a week of history exists. */}
      <Card className="mb-4 flex h-28 items-center justify-center p-5">
        <p className="text-center text-[13px] font-medium text-ink-soft">
          Your price chart begins after your first week closes.
        </p>
      </Card>

      {/* Positions · Habits — fills in once habits are added (creation flow next). */}
      <Card className="p-5">
        <div className="flex items-baseline justify-between">
          <Kicker as="h2">Positions · Habits</Kicker>
          <span className="font-mono text-[10px] uppercase tracking-[1.3px] text-ink-muted">
            Net $0/wk
          </span>
        </div>
        <p className="mt-3 text-[14px] font-medium leading-[1.5] text-ink-soft">
          No positions yet. Add your habits — one morning, one daily, one weekly,
          plus two vices to pay down — and each becomes a position that moves
          your value every week.
        </p>
      </Card>
    </div>
  );
}

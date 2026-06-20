import { getAuthUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { StormBackground } from "@/components/brand/StormBackground";
import { Card } from "@/components/ui/card";
import { Kicker } from "@/components/ui/kicker";
import { getOperatingState, type HomePosition } from "@/lib/price/runner";
import { formatDollars, formatSignedDollars } from "@/lib/utils";

const CADENCE_TAG: Record<string, string> = {
  morning: "Morning",
  daily: "Daily",
  weekly: "Weekly",
};

// Home — the portfolio (spec §Home, fixed layout). The operating value is the
// REAL, server-derived number: getOperatingState folds the append-only
// price_ledger (realized) plus the current week's provisional mark, settling any
// elapsed weeks first, and returns the active roster as position rows. The client
// never computes the authoritative value.
//
// Real today: operating value, this-week movement, and each position's term
// progress / days-clean / per-line contribution. Deferred (need the daily
// snapshot store, not yet built): the trend chart and the day/day delta.
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

  const assets = state.positions.filter((p) => p.kind === "asset");
  const vices = state.positions.filter((p) => p.kind === "liability");
  const netContribCents = state.positions.reduce((s, p) => s + p.contribCents, 0);

  const weekDelta = state.provisionalCents; // current week's unbooked movement
  const deltaTone = toneFor(weekDelta);
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
          <span className="text-ink-soft">· — today</span>
        </div>
      </div>

      {/* Trend chart — begins once a week of history exists. */}
      <Card className="mb-4 flex h-28 items-center justify-center p-5">
        <p className="text-center text-[13px] font-medium text-ink-soft">
          Your price chart begins after your first week closes.
        </p>
      </Card>

      {/* Positions · Habits */}
      <Card className="p-5">
        <div className="flex items-baseline justify-between">
          <Kicker as="h2">Positions · Habits</Kicker>
          {state.positions.length === 0 ? (
            <Link
              href="/habits"
              className="font-mono text-[10px] uppercase tracking-[1.3px] text-accent-ink"
            >
              Manage
            </Link>
          ) : (
            <span className={`font-mono text-[10px] uppercase tracking-[1.3px] ${toneFor(netContribCents)}`}>
              Net {formatSignedDollars(netContribCents)}/wk
            </span>
          )}
        </div>

        {state.positions.length === 0 ? (
          <p className="mt-3 text-[14px] font-medium leading-[1.5] text-ink-soft">
            No positions yet. Add your{" "}
            <Link href="/habits" className="text-accent-ink underline">
              habits
            </Link>{" "}
            — one morning, one daily, one weekly, plus two vices to pay down — and
            each becomes a position that moves your value every week.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            {assets.length > 0 && (
              <div className="space-y-2.5">
                <Kicker>Assets · building</Kicker>
                {assets.map((p) => (
                  <PositionRow key={p.habitId} p={p} />
                ))}
              </div>
            )}
            {vices.length > 0 && (
              <div className="space-y-2.5">
                <Kicker>Liabilities · paying down</Kicker>
                {vices.map((p) => (
                  <PositionRow key={p.habitId} p={p} />
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function toneFor(cents: number): string {
  return cents > 0 ? "text-positive" : cents < 0 ? "text-danger" : "text-ink-soft";
}

function PositionRow({ p }: { p: HomePosition }) {
  const isAsset = p.kind === "asset";
  const tag = isAsset ? CADENCE_TAG[p.cadence ?? ""] ?? "Asset" : "Vice";
  const meta = isAsset
    ? p.dayOfTerm && p.termDays
      ? `Day ${p.dayOfTerm}/${p.termDays}`
      : p.termDays
        ? `${p.termDays}-day term`
        : ""
    : `${p.daysClean} ${p.daysClean === 1 ? "day" : "days"} clean`;

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <span className="font-mono text-[9px] uppercase tracking-[1.2px] text-ink-soft">
          {tag}
          {meta ? ` · ${meta}` : ""}
        </span>
        <p className="truncate text-[14px] font-medium text-ink">{p.title}</p>
      </div>
      <span className={`shrink-0 text-[13px] font-semibold tabular-nums ${toneFor(p.contribCents)}`}>
        {formatSignedDollars(p.contribCents)}/wk
      </span>
    </div>
  );
}

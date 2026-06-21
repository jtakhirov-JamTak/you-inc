import { getAuthUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Kicker } from "@/components/ui/kicker";
import { CategoryBadge, badgeKindFor } from "@/components/ui/category-badge";
import { OperatingValuePanel } from "@/components/ui/operating-value-panel";
import { getOperatingState, type HomePosition, type HomeSprint } from "@/lib/price/runner";
import { formatSignedDollars } from "@/lib/utils";

// Home — the portfolio (design handoff §1). The operating value is the REAL,
// server-derived number: getOperatingState folds the append-only price_ledger
// (realized) plus the current week's provisional mark, settling any elapsed weeks
// first, and returns the roster as position rows, the week/day deltas, the weekly
// trend series, and the active/queued sprints. The client never computes the value.

const CADENCE_TAG: Record<string, string> = { morning: "Morning", daily: "Daily", weekly: "Weekly" };
const AREA_LABEL: Record<string, string> = {
  health: "Health",
  wealth: "Wealth",
  relationships: "Relationships",
};

function toneFor(cents: number): string {
  return cents > 0 ? "text-positive" : cents < 0 ? "text-danger" : "text-ink-soft";
}

export default async function HomePage() {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  // getOperatingState runs under the service role (bypasses RLS): pass the
  // AUTHENTICATED user's id only.
  let state: Awaited<ReturnType<typeof getOperatingState>> | null = null;
  try {
    state = await getOperatingState(user.id);
  } catch {
    state = null;
  }

  if (!state) {
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

  const assets = state.positions.filter((p) => p.kind === "asset");
  const vices = state.positions.filter((p) => p.kind === "liability");
  const netContribCents = state.positions.reduce((s, p) => s + p.contribCents, 0);
  const { active, queued } = state.sprints;

  const netArrow = netContribCents > 0 ? "▲" : netContribCents < 0 ? "▼" : "·";

  return (
    <div className="mx-auto min-h-full max-w-[460px] px-[18px] pt-3">
      <HomeHeader />

      {/* Operating value + period-matched change + centered trend chart */}
      <OperatingValuePanel
        displayedCents={state.displayedCents}
        baselineCents={state.baselineCents}
        series={state.series}
        intraday={state.intraday}
      />

      {/* Positions · Habits */}
      <section className="mt-6">
        <div className="flex items-baseline justify-between px-0.5">
          <Kicker as="h2" className="tracking-[0.12em]">Positions · Habits</Kicker>
          {state.positions.length === 0 ? (
            <Link href="/habits" className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft underline">
              Manage
            </Link>
          ) : (
            <span className={`font-mono text-[12px] font-semibold tabular-nums ${toneFor(netContribCents)}`}>
              Net {netArrow} {formatSignedDollars(netContribCents)}
            </span>
          )}
        </div>

        {state.positions.length === 0 ? (
          <div className="mt-2.5 rounded-card border border-hairline bg-surface p-5">
            <p className="text-[14px] font-medium leading-[1.5] text-ink-soft">
              No positions yet. Add your{" "}
              <Link href="/habits" className="text-ink underline">habits</Link>{" "}
              — one morning, one daily, one weekly, plus two vices to pay down — and each becomes a
              position that moves your value every week.
            </p>
          </div>
        ) : (
          <div className="mt-2.5 rounded-card border border-hairline bg-surface px-4">
            {assets.length > 0 && (
              <div className="py-1">
                <div className="flex items-baseline justify-between py-2.5">
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-positive">Assets · building</span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">Contrib / wk</span>
                </div>
                <div className="space-y-3 pb-3">
                  {assets.map((p) => (
                    <PositionRow key={p.habitId} p={p} />
                  ))}
                </div>
              </div>
            )}
            {vices.length > 0 && (
              <div className={`py-1 ${assets.length > 0 ? "border-t border-divider" : ""}`}>
                <div className="flex items-baseline justify-between py-2.5">
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-danger">Liabilities · paying down</span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">Days clean</span>
                </div>
                <div className="space-y-3 pb-3">
                  {vices.map((p) => (
                    <PositionRow key={p.habitId} p={p} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Investments · Sprints */}
      <section className="mt-6">
        <div className="flex items-baseline justify-between px-0.5">
          <Kicker as="h2" className="tracking-[0.12em]">Investments · Sprints</Kicker>
          <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-warm">
            {active ? "1 ACTIVE" : "0 ACTIVE"}
          </span>
        </div>

        {!active && queued.length === 0 ? (
          <div className="mt-2.5 rounded-card border border-hairline bg-surface p-5">
            <p className="text-[14px] font-medium leading-[1.5] text-ink-soft">
              No active investment. Start a{" "}
              <Link href="/sprints" className="text-ink underline">sprint</Link>{" "}
              — a 10–14 day push toward a year goal — and its return books to your value at close.
            </p>
          </div>
        ) : (
          <div className="mt-2.5 space-y-2.5">
            {active && <ActiveSprintCard s={active} />}
            {queued.map((s) => (
              <QueuedSprintRow key={s.sprintId} s={s} />
            ))}
          </div>
        )}
      </section>
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
        <div className="text-[13.5px] font-bold text-ink">You, Inc.</div>
        <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-muted">$YOU · Privately held</div>
      </div>
    </div>
  );
}

function PositionRow({ p }: { p: HomePosition }) {
  const isAsset = p.kind === "asset";
  const tag = isAsset ? CADENCE_TAG[p.cadence ?? ""] ?? "Asset" : "Vice";
  const subline = isAsset
    ? [tag, p.termDays ? `${p.termDays}-day term` : null, p.dayOfTerm ? `day ${p.dayOfTerm}` : null]
        .filter(Boolean)
        .join(" · ")
    : `${p.daysClean} ${p.daysClean === 1 ? "day" : "days"} clean · open`;

  return (
    <div className="flex items-center gap-3">
      <CategoryBadge kind={badgeKindFor(p.kind, p.cadence)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold leading-tight text-ink">{p.title}</p>
        <p className="mt-0.5 truncate text-[10.5px] text-ink-soft">{subline}</p>
      </div>
      <div className="shrink-0 text-right">
        <div className={`font-mono text-[13px] font-semibold tabular-nums ${toneFor(p.contribCents)}`}>
          {formatSignedDollars(p.contribCents)}
        </div>
        {!isAsset && <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-ink-faint">clean</div>}
      </div>
    </div>
  );
}

function ActiveSprintCard({ s }: { s: HomeSprint }) {
  const pct = s.dayOfTerm && s.termDays ? Math.min(100, Math.round((s.dayOfTerm / s.termDays) * 100)) : 0;
  return (
    <div className="rounded-card border border-gold-border bg-gold-bg p-4">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-gold-label">Active · 10–14 day push</span>
        <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-gold-label">
          Day {s.dayOfTerm ?? 0} / {s.termDays}
        </span>
      </div>
      <h3 className="mt-2 text-[18px] font-bold leading-tight text-ink">{s.thesis}</h3>
      <p className="mt-0.5 text-[11px] text-gold-deep">Invested toward year goal · {AREA_LABEL[s.area] ?? s.area}</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-[3px] bg-gold-border">
        <div className="h-full rounded-[3px] bg-warm" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2.5 flex items-baseline justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-gold-label">Unrealized return</span>
        <span className={`font-mono text-[14px] font-semibold tabular-nums ${
          (s.unrealizedReturnCents ?? 0) > 0 ? "text-positive" : (s.unrealizedReturnCents ?? 0) < 0 ? "text-danger" : "text-gold-deep"
        }`}>
          {formatSignedDollars(s.unrealizedReturnCents ?? 0)}
        </span>
      </div>
    </div>
  );
}

function QueuedSprintRow({ s }: { s: HomeSprint }) {
  return (
    <div className="flex items-center justify-between rounded-card-sm border border-hairline bg-surface p-3.5">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-ink">{s.thesis}</p>
        <p className="mt-0.5 text-[10.5px] text-ink-soft">Queued · toward {AREA_LABEL[s.area] ?? s.area}</p>
      </div>
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">
        Starts {s.startsInDays ?? 0}d
      </span>
    </div>
  );
}

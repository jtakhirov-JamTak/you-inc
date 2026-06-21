"use client";

import { useEffect, useMemo, useState } from "react";
import { cn, formatDollars, formatSignedDollars } from "@/lib/utils";

// Home's operating-value panel: the balance, a single period-matched change, and a
// centered trend chart with range pills. The chart always opens at the vertical
// CENTER (the period's opening value) and deviates up/down from there. The change
// shown under the balance tracks the SELECTED range (no fixed Day/Day or Week/Week).
//
// The 1D range is anchored to a 6 AM "day" (6 AM → 5:59 AM): the server feeds an
// intraday series whose x is minutes-since-6 AM. The weekly ranges window the
// weekly closing series; their opening value is centered the same way.

interface IntradayToday {
  dayOpenCents: number;
  points: { minuteSince6am: number; valueCents: number }[];
  localDate: string;
}
interface SeriesPoint {
  weekEnd: string;
  closingCents: number;
}

type Range = "1D" | "1W" | "1M" | "3M" | "ALL";
const ALL_RANGES: Range[] = ["1D", "1W", "1M", "3M", "ALL"];
const RANGE_LABEL: Record<Range, string> = {
  "1D": "Today",
  "1W": "This week",
  "1M": "This month",
  "3M": "3 months",
  ALL: "Since you started",
};
// Trailing weekly points (including the live point) per multi-week range. The
// history we slice has the inception baseline prepended, so a short history simply
// opens at the baseline.
const TRAILING: Record<Exclude<Range, "1D">, number> = { "1W": 2, "1M": 5, "3M": 13, ALL: Infinity };

const W = 340;
const H = 146;
const PAD = 12;
const DAY_MINUTES = 1440;

// Browser-local minutes since the 6 AM day-open (0..1439), for the advancing "now"
// marker. Derived fresh from the clock each call (no stale closure).
function minutesSince6amNow(): number {
  const now = new Date();
  const m = now.getHours() * 60 + now.getMinutes();
  return (m - 360 + DAY_MINUTES) % DAY_MINUTES;
}

// Center the FIRST value on the mid-line and scale by the largest deviation from
// it, so the open sits at H/2 and the line rises/falls symmetrically. xs are the
// pre-computed x positions aligned to values.
function centeredWeeklyPaths(values: number[], xs: number[]) {
  const open = values[0];
  const maxDev = Math.max(1, ...values.map((v) => Math.abs(v - open)));
  const yMid = H / 2;
  const yOf = (v: number) => yMid - ((v - open) / maxDev) * (H / 2 - PAD);
  let line = "";
  values.forEach((v, i) => {
    line += `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)} ${yOf(v).toFixed(1)} `;
  });
  const lastX = xs[xs.length - 1];
  const area = `${line}L${lastX.toFixed(1)} ${H} L${xs[0].toFixed(1)} ${H} Z`;
  return { line: line.trim(), area, endX: lastX, endY: yOf(values[values.length - 1]) };
}

// 1D step line on a 6 AM-anchored x-axis (0 = 6 AM, right = next 5:59 AM), centered
// on the day-open. Holds flat, steps at each completion's minute, holds to "now".
function centeredIntradayPaths(
  dayOpenCents: number,
  points: { minuteSince6am: number; valueCents: number }[],
  nowMinute: number,
) {
  const values = [dayOpenCents, ...points.map((p) => p.valueCents)];
  const maxDev = Math.max(1, ...values.map((v) => Math.abs(v - dayOpenCents)));
  const yMid = H / 2;
  const xOf = (m: number) => (Math.max(0, Math.min(m, DAY_MINUTES)) / DAY_MINUTES) * W;
  const yOf = (v: number) => yMid - ((v - dayOpenCents) / maxDev) * (H / 2 - PAD);

  const lastMin = points.length ? points[points.length - 1].minuteSince6am : 0;
  const nowX = xOf(Math.max(nowMinute, lastMin)); // don't pull "now" left of the last step

  let d = `M0 ${yOf(dayOpenCents).toFixed(1)}`;
  let last = dayOpenCents;
  for (const p of points) {
    const px = xOf(p.minuteSince6am);
    d += ` L${px.toFixed(1)} ${yOf(last).toFixed(1)}`; // horizontal hold
    d += ` L${px.toFixed(1)} ${yOf(p.valueCents).toFixed(1)}`; // vertical step
    last = p.valueCents;
  }
  d += ` L${nowX.toFixed(1)} ${yOf(last).toFixed(1)}`; // hold flat to now
  const area = `${d} L${nowX.toFixed(1)} ${H} L0 ${H} Z`;
  return { line: d, area, endX: nowX, endY: yOf(last) };
}

export function OperatingValuePanel({
  displayedCents,
  baselineCents,
  series,
  intraday,
}: {
  displayedCents: number;
  baselineCents: number;
  series: SeriesPoint[];
  intraday: IntradayToday;
}) {
  const hasIntraday = intraday.localDate !== "";
  const ranges = hasIntraday ? ALL_RANGES : (["1W", "1M", "3M", "ALL"] as Range[]);
  const [range, setRange] = useState<Range>(hasIntraday ? "1D" : "1W");

  // Advance the "now" marker on a wall-clock timer while 1D is showing.
  const [nowMinute, setNowMinute] = useState<number>(() => minutesSince6amNow());
  useEffect(() => {
    if (range !== "1D") return;
    const tick = () => setNowMinute(minutesSince6amNow());
    tick();
    const id = setInterval(tick, 30_000);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [range]);

  // Per-range opening value + chart geometry. The opening value is centered; the
  // displayed value is "now". Delta = now − open.
  const view = useMemo(() => {
    if (range === "1D" && hasIntraday) {
      const paths = centeredIntradayPaths(intraday.dayOpenCents, intraday.points, nowMinute);
      return { openCents: intraday.dayOpenCents, ...paths, hasLine: true };
    }
    // Weekly ranges: prepend the inception baseline so a short history opens there.
    const history = [baselineCents, ...series.map((p) => p.closingCents)];
    const take = TRAILING[range as Exclude<Range, "1D">] ?? Infinity;
    const visible = take === Infinity ? history : history.slice(Math.max(0, history.length - take));
    if (visible.length < 2) {
      // Nothing to draw yet — a flat line at center.
      const yMid = H / 2;
      return {
        openCents: visible[0] ?? baselineCents,
        line: `M0 ${yMid} L${W} ${yMid}`,
        area: `M0 ${yMid} L${W} ${yMid} L${W} ${H} L0 ${H} Z`,
        endX: W,
        endY: yMid,
        hasLine: true,
      };
    }
    const xs = visible.map((_, i) => (i / (visible.length - 1)) * W);
    const paths = centeredWeeklyPaths(visible, xs);
    return { openCents: visible[0], ...paths, hasLine: true };
  }, [range, hasIntraday, intraday, nowMinute, series, baselineCents]);

  const deltaCents = displayedCents - view.openCents;
  const pct = view.openCents > 0 ? (deltaCents / view.openCents) * 100 : 0;
  const up = deltaCents >= 0;
  const arrow = deltaCents > 0 ? "▲" : deltaCents < 0 ? "▼" : "·";
  const color = up ? "var(--color-positive)" : "var(--color-danger)";
  const fillId = up ? "trendfill-up" : "trendfill-down";
  const toneClass = deltaCents > 0 ? "text-positive" : deltaCents < 0 ? "text-danger" : "text-ink-soft";
  const pctLabel = `${deltaCents >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%`;

  return (
    <div>
      {/* Operating value + period-matched change */}
      <section className="mt-6">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">
          Operating value
        </span>
        <div className="mt-2 font-mono text-[48px] font-semibold leading-none tracking-[-0.035em] text-ink tabular-nums">
          {formatDollars(displayedCents)}
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className={`text-[20px] font-semibold leading-none tabular-nums ${toneClass}`}>
            {arrow} {formatSignedDollars(deltaCents)}
          </span>
          <span className={`font-mono text-[13px] font-semibold tabular-nums ${toneClass}`}>{pctLabel}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
            {RANGE_LABEL[range]}
          </span>
        </div>
      </section>

      {/* Centered trend chart */}
      <div className="mt-5 rounded-card border border-hairline bg-surface px-3.5 pb-2.5 pt-3.5">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Operating value, ${RANGE_LABEL[range]} — ${up ? "up" : "down"} ${formatSignedDollars(
            deltaCents,
          )} (${pctLabel})`}
        >
          <defs>
            <linearGradient id="trendfill-up" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-positive)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--color-positive)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="trendfill-down" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-danger)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--color-danger)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Gridlines; the center line is the opening-value baseline. */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1="0"
              x2={W}
              y1={H * f}
              y2={H * f}
              stroke="var(--color-divider)"
              strokeWidth={f === 0.5 ? 1.25 : 1}
              strokeDasharray={f === 0.5 ? undefined : "2 3"}
            />
          ))}
          <path d={view.area} fill={`url(#${fillId})`} />
          <path
            d={view.line}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx={view.endX} cy={view.endY} r="3" fill={color} />
        </svg>

        <div className="mt-2.5 flex gap-1.5">
          {ranges.map((r) => {
            const active = r === range;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                aria-pressed={active}
                className={cn(
                  "rounded-[7px] px-[11px] py-1 font-mono text-[10px] tracking-[0.04em] transition-colors",
                  active
                    ? "bg-accent text-accent-text"
                    : "border border-hairline text-ink-muted active:bg-surface-tint",
                )}
              >
                {r}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

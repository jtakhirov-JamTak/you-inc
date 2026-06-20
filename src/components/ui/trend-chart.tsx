"use client";

import { useEffect, useMemo, useState } from "react";
import { cn, formatSignedDollars } from "@/lib/utils";

// Shape of the intraday "today" series the server builds (runner.IntradayToday).
// Declared locally — structural typing keeps it compatible — so this client
// component never imports the server-only runner module.
interface IntradayToday {
  dayOpenCents: number;
  points: { minuteOfDay: number; valueCents: number }[];
  localDate: string;
}

// Operating-value trend chart (design handoff §Home chart + §Board mini chart).
// `area` = Home's green/red area chart with range pills; `line` = Board's bare ink
// polyline. Home gets a "1D" range fed an intraday series (today's value stepping
// up at each affirmative log, Robinhood-style); the other ranges window the weekly
// closing series client-side. Color follows direction: green when the visible
// window is up, red when down.

export interface TrendPoint {
  weekEnd: string;
  closingCents: number;
}

type Range = "1D" | "1W" | "1M" | "3M" | "1Y" | "ALL";
const WEEKLY_RANGES: Range[] = ["1W", "1M", "3M", "1Y", "ALL"];
// Trailing weekly points per range (the series is weekly + 1 live point).
const TRAILING: Record<Exclude<Range, "1D">, number> = {
  "1W": 2,
  "1M": 5,
  "3M": 13,
  "1Y": 53,
  ALL: Infinity,
};

// Weekly ranges: evenly-spaced points by index.
function buildPaths(values: number[], w: number, h: number, pad: number) {
  const n = values.length;
  if (n < 2) return { line: "", area: "" };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (n === 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${w.toFixed(1)} ${h} L0 ${h} Z`;
  return { line, area };
}

// 1D: time-of-day x-axis (left = local 00:00, right = 24:00). A step line that
// holds flat at the day-open value, steps up/down at each log's minute, then holds
// flat to "now". The area fills only up to the now-x.
function buildIntradayPaths(
  dayOpenCents: number,
  points: { minuteOfDay: number; valueCents: number }[],
  nowMinute: number,
  w: number,
  h: number,
  pad: number,
) {
  const values = [dayOpenCents, ...points.map((p) => p.valueCents)];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xOf = (m: number) => (Math.max(0, Math.min(m, 1440)) / 1440) * w;
  const yOf = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);

  // Don't let a small clock skew pull "now" left of the last logged step.
  const lastMin = points.length ? points[points.length - 1].minuteOfDay : 0;
  const nowX = xOf(Math.max(nowMinute, lastMin));

  let d = `M0 ${yOf(dayOpenCents).toFixed(1)}`;
  let lastValue = dayOpenCents;
  for (const p of points) {
    const px = xOf(p.minuteOfDay);
    d += ` L${px.toFixed(1)} ${yOf(lastValue).toFixed(1)}`; // horizontal hold
    d += ` L${px.toFixed(1)} ${yOf(p.valueCents).toFixed(1)}`; // vertical step
    lastValue = p.valueCents;
  }
  d += ` L${nowX.toFixed(1)} ${yOf(lastValue).toFixed(1)}`; // hold flat to now

  const endY = yOf(lastValue);
  const area = `${d} L${nowX.toFixed(1)} ${h} L0 ${h} Z`;
  return { line: d, area, endX: nowX, endY, up: lastValue >= dayOpenCents };
}

// Browser-local minute-of-day for the advancing "now" marker. Derived fresh from
// the clock each call (no stale closure); the user's browser zone is their zone.
function minutesNowInLocalDay(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export function TrendChart({
  points,
  intraday,
  variant = "area",
  className,
}: {
  points: TrendPoint[];
  intraday?: IntradayToday;
  variant?: "area" | "line";
  className?: string;
}) {
  const isArea = variant === "area";
  const showIntraday = isArea && !!intraday;
  const ranges: Range[] = showIntraday ? ["1D", ...WEEKLY_RANGES] : WEEKLY_RANGES;
  const [range, setRange] = useState<Range>(showIntraday ? "1D" : "1W");
  const showRanges = isArea;

  // Advance the "now" marker on a wall-clock timer while 1D is showing — no fetch;
  // new log values arrive via the page's router.refresh() after a tap. Resync on
  // tab focus/visibility so a backgrounded tab catches up.
  const [nowMinute, setNowMinute] = useState<number>(() => minutesNowInLocalDay());
  useEffect(() => {
    if (range !== "1D") return;
    const tick = () => setNowMinute(minutesNowInLocalDay());
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

  const visible = useMemo(() => {
    if (!showRanges || range === "1D") return points;
    const take = TRAILING[range];
    return take === Infinity ? points : points.slice(Math.max(0, points.length - take));
  }, [points, range, showRanges]);

  const W = isArea ? 340 : 330;
  const H = isArea ? 146 : 50;
  const PAD = isArea ? 12 : 6;

  const is1D = range === "1D" && showIntraday;
  const weeklyValues = visible.map((p) => p.closingCents);
  const weeklyUp =
    weeklyValues.length >= 2 ? weeklyValues[weeklyValues.length - 1] >= weeklyValues[0] : true;

  const intra = is1D
    ? buildIntradayPaths(intraday!.dayOpenCents, intraday!.points, nowMinute, W, H, PAD)
    : null;
  const weekly = is1D ? null : buildPaths(weeklyValues, W, H, PAD);

  const line = intra ? intra.line : weekly?.line ?? "";
  const area = intra ? intra.area : weekly?.area ?? "";
  const hasLine = line !== "";
  const up = intra ? intra.up : weeklyUp;
  const fillId = up ? "trendfill-up" : "trendfill-down";
  const color = isArea
    ? up
      ? "var(--color-positive)"
      : "var(--color-danger)"
    : "var(--color-ink)";

  const ariaLabel = is1D
    ? `Operating value today — ${intra!.up ? "up" : "down"} ${formatSignedDollars(
        intraday!.points.length
          ? intraday!.points[intraday!.points.length - 1].valueCents - intraday!.dayOpenCents
          : 0,
      )} so far`
    : `Operating value trend, ${range}`;

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
      >
        {isArea && (
          <>
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
            {[0.25, 0.5, 0.75].map((f) => (
              <line
                key={f}
                x1="0"
                x2={W}
                y1={H * f}
                y2={H * f}
                stroke="var(--color-divider)"
                strokeWidth="1"
              />
            ))}
          </>
        )}
        {hasLine ? (
          <>
            {isArea && <path d={area} fill={`url(#${fillId})`} />}
            <path
              d={line}
              fill="none"
              stroke={color}
              strokeWidth={isArea ? 2.5 : 1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {/* "Now" marker on the 1D view — a small dot at the live right edge. */}
            {intra && (
              <circle cx={intra.endX} cy={intra.endY} r="3" fill={color} />
            )}
          </>
        ) : (
          <text
            x={W / 2}
            y={H / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="11"
            fill="var(--color-ink-muted)"
            fontFamily="var(--font-mono)"
          >
            Chart fills in as weeks close
          </text>
        )}
      </svg>

      {showRanges && (
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
      )}
    </div>
  );
}

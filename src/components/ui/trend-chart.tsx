"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

// Weekly operating-value trend chart. `line` = the Board's bare ink polyline;
// `area` = a green/red area chart with range pills. Color follows direction: green
// when the visible window is up, red when down.
//
// Home's live operating-value chart (centered baseline, 6 AM intraday, range-matched
// delta) is its own component — see operating-value-panel.tsx. This component is the
// weekly mini-chart; the Board uses the `line` variant.

export interface TrendPoint {
  weekEnd: string;
  closingCents: number;
}

type Range = "1W" | "1M" | "3M" | "1Y" | "ALL";
const WEEKLY_RANGES: Range[] = ["1W", "1M", "3M", "1Y", "ALL"];
// Trailing weekly points per range (the series is weekly + 1 live point).
const TRAILING: Record<Range, number> = {
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

export function TrendChart({
  points,
  variant = "area",
  className,
}: {
  points: TrendPoint[];
  variant?: "area" | "line";
  className?: string;
}) {
  const isArea = variant === "area";
  const showRanges = isArea;
  const [range, setRange] = useState<Range>("1W");

  const visible = useMemo(() => {
    if (!showRanges) return points;
    const take = TRAILING[range];
    return take === Infinity ? points : points.slice(Math.max(0, points.length - take));
  }, [points, range, showRanges]);

  const W = isArea ? 340 : 330;
  const H = isArea ? 146 : 50;
  const PAD = isArea ? 12 : 6;

  const values = visible.map((p) => p.closingCents);
  const up = values.length >= 2 ? values[values.length - 1] >= values[0] : true;

  const { line, area } = buildPaths(values, W, H, PAD);
  const hasLine = line !== "";
  const fillId = up ? "trendfill-up" : "trendfill-down";
  const color = isArea
    ? up
      ? "var(--color-positive)"
      : "var(--color-danger)"
    : "var(--color-ink)";

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Operating value trend, ${range}`}
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
          {WEEKLY_RANGES.map((r) => {
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

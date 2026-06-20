"use client";

import { useEffect, useState } from "react";
import { Kicker } from "@/components/ui/kicker";

// The weekly performance analysis. The server passes a cached result when one
// exists for the current prompt version; otherwise this component generates it once
// on mount (the model call is cost-gated server-side). It never shows a blank or raw
// state: below the evidence threshold it shows a "keep logging" message, and if the
// AI phrasing fails it falls back to the deterministic pattern statements.

interface AnalysisText {
  headline: string;
  body: string;
  takeaway: string;
}
interface Pattern {
  kind: string;
  direction: "positive" | "negative" | "neutral";
  statement: string;
}
export interface InitialAnalysis {
  state: "insufficient" | "emerging" | "established";
  text: AnalysisText | null;
  patterns: Pattern[];
}

type View =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: InitialAnalysis };

export function PerformanceAnalysis({
  meetingId,
  initial,
}: {
  meetingId: string;
  initial: InitialAnalysis | null;
}) {
  const [view, setView] = useState<View>(
    initial ? { status: "ready", data: initial } : { status: "loading" },
  );
  // Retry re-runs the (unmount-guarded) effect by bumping this key.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (initial) return;
    let alive = true;
    setView({ status: "loading" });
    (async () => {
      try {
        const res = await fetch("/api/board/analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meetingId }),
        });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as InitialAnalysis;
        if (alive) setView({ status: "ready", data });
      } catch {
        if (alive) setView({ status: "error" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [initial, meetingId, reloadKey]);

  return (
    <section className="mt-6 rounded-card border border-hairline bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <Kicker as="h2" className="tracking-[0.12em] text-ink-muted">
          Performance analysis
        </Kicker>
        {view.status === "ready" && view.data.state !== "insufficient" && (
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint">
            {view.data.state === "established" ? "Established" : "Emerging"} · 6-week
          </span>
        )}
      </div>

      <div className="mt-3" role="status" aria-live="polite">
        {view.status === "loading" && (
          <div className="space-y-2.5" aria-label="Generating analysis">
            <div className="h-4 w-2/3 animate-pulse rounded bg-hairline" />
            <div className="h-3 w-full animate-pulse rounded bg-hairline" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-hairline" />
          </div>
        )}

        {view.status === "error" && (
          <p role="alert" className="text-[14px] font-medium leading-[1.5] text-ink-soft">
            Couldn&apos;t generate your analysis just now.{" "}
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="inline-flex min-h-11 items-center font-semibold text-ink underline"
            >
              Retry
            </button>
          </p>
        )}

        {view.status === "ready" && <Ready data={view.data} />}
      </div>
    </section>
  );
}

function Ready({ data }: { data: InitialAnalysis }) {
  if (data.state === "insufficient") {
    return (
      <p className="text-[14px] font-medium leading-[1.5] text-ink-soft">
        Not enough data yet. Your performance analysis is built from a rolling six weeks of
        habit and sprint activity — keep logging, and the first read appears once a couple of
        weeks of patterns accrue.
      </p>
    );
  }

  // AI phrasing present — the primary read.
  if (data.text) {
    return (
      <div>
        <h3 className="text-[17px] font-bold leading-[1.25] text-ink">{data.text.headline}</h3>
        <p className="mt-2 text-[15px] font-medium leading-[1.5] text-[#39342c]">{data.text.body}</p>
        <div className="mt-3 rounded-card-sm border border-hairline-strong bg-cream px-4 py-3">
          <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-muted">
            This week&apos;s move
          </span>
          <p className="mt-1 text-[14px] font-semibold leading-[1.4] text-ink">{data.text.takeaway}</p>
        </div>
      </div>
    );
  }

  // AI unavailable — fall back to the deterministic statements (never blank).
  return (
    <div>
      <p className="text-[13px] font-medium leading-[1.5] text-ink-soft">
        Here&apos;s what your last six weeks show:
      </p>
      <ul className="mt-2 space-y-2">
        {data.patterns.map((p, i) => (
          <li key={`${p.kind}-${i}`} className="flex gap-2.5 text-[14px] leading-[1.45] text-ink">
            <span
              aria-hidden
              className={
                p.direction === "positive"
                  ? "text-positive"
                  : p.direction === "negative"
                    ? "text-danger"
                    : "text-ink-soft"
              }
            >
              {p.direction === "positive" ? "▲" : p.direction === "negative" ? "▼" : "·"}
            </span>
            <span>{p.statement}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

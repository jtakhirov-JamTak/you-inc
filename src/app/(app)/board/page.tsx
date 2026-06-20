import { getAuthUser, createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Kicker } from "@/components/ui/kicker";
import { TrendChart } from "@/components/ui/trend-chart";
import { settleUser } from "@/lib/price/runner";
import { formatDollars, formatSignedDollars } from "@/lib/utils";

// Board — the weekly statement (design handoff §4). A read view of the latest
// settled week, styled as a one-page operating statement. The statement figures
// (closing value, week delta, per-area split) are written server-side by
// settleUser into board_meetings; this page reads them back. Authoring the note /
// resolutions and the "adjourn" action are a later increment.

const AREAS: { key: "health" | "wealth" | "relationships"; label: string }[] = [
  { key: "health", label: "Health" },
  { key: "wealth", label: "Wealth" },
  { key: "relationships", label: "Relations" },
];

function tone(cents: number): string {
  return cents > 0 ? "text-positive" : cents < 0 ? "text-danger" : "text-ink-muted";
}

export default async function BoardPage() {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  // Ensure any elapsed week is booked so the latest statement is current. Runs
  // under the service role; pass the authenticated id only.
  try {
    await settleUser(user.id);
  } catch {
    // Non-fatal: fall through to read whatever is already booked.
  }

  const supabase = await createClient();
  const { data: meetings, error } = await supabase
    .from("board_meetings")
    .select("id, week_index, closing_value_cents, week_delta_cents, note, area_contributions, settled_at")
    .eq("user_id", user.id)
    .order("week_index", { ascending: true });

  if (error) {
    return (
      <Shell>
        <div className="mt-8 rounded-card border border-liability-border bg-liability-bg p-5">
          <Kicker as="h2">Statement unavailable</Kicker>
          <p className="mt-2 text-[14px] font-medium leading-[1.5] text-ink-soft">
            We couldn&apos;t read your board meeting just now. Refresh in a moment.
          </p>
        </div>
      </Shell>
    );
  }

  const rows = meetings ?? [];
  const latest = rows.length > 0 ? rows[rows.length - 1] : null;

  if (!latest) {
    return (
      <Shell>
        <div className="mt-10 rounded-card border border-hairline bg-surface p-6 text-center">
          <Kicker className="tracking-[0.16em] text-ink-muted">No statement yet</Kicker>
          <p className="mx-auto mt-3 max-w-[300px] text-[14px] font-medium leading-[1.55] text-ink-soft">
            Your first board meeting opens after week one closes. Each Sunday&apos;s review appears
            here — what moved the price, and what to resolve for the week ahead.
          </p>
        </div>
      </Shell>
    );
  }

  const delta = latest.week_delta_cents;
  const prevClosing = latest.closing_value_cents - delta;
  const pct = prevClosing !== 0 ? (delta / prevClosing) * 100 : 0;
  const pctStr = `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}% this week`;
  const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "·";
  const areaContribs = (latest.area_contributions ?? {}) as Record<string, number>;
  const series = rows.map((r) => ({
    weekEnd: String(r.settled_at ?? "").slice(0, 10),
    closingCents: r.closing_value_cents,
  }));

  // Latest meeting's resolutions (carried into the following week).
  const { data: resolutions } = await supabase
    .from("board_resolutions")
    .select("id, text, checked")
    .eq("user_id", user.id)
    .eq("meeting_id", latest.id)
    .order("created_at", { ascending: true });

  return (
    <Shell>
      {/* Statement header */}
      <div className="mt-1 flex items-baseline justify-between font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-muted">
        <span>Weekly statement</span>
        <span>Vol.1 · W{latest.week_index}</span>
      </div>
      <div className="mt-2 border-t border-ink" />

      {/* Title */}
      <h1 className="mt-5 font-display text-[42px] font-extrabold leading-[1.02] tracking-[-0.035em] text-ink">
        Board
        <br />
        meeting.
      </h1>
      <p className="mt-2 text-[13px] text-ink-soft">Sunday review · what moved the price.</p>

      {/* Closing value */}
      <div className="mt-7 flex items-end justify-between">
        <div>
          <Kicker className="tracking-[0.12em] text-ink-muted">Closing value</Kicker>
          <div className="mt-1.5 font-mono text-[34px] font-semibold leading-none tracking-[-0.02em] text-ink tabular-nums">
            {formatDollars(latest.closing_value_cents)}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-[14px] font-semibold tabular-nums ${tone(delta)}`}>
            {arrow} {formatSignedDollars(delta)}
          </div>
          <div className={`mt-0.5 font-mono text-[10.5px] ${tone(delta)}`}>{pctStr}</div>
        </div>
      </div>

      {/* Mini chart */}
      <TrendChart points={series} variant="line" className="mt-5" />

      {/* Note to the chair */}
      <div className="mt-6 border-y border-hairline py-4">
        <Kicker className="tracking-[0.12em] text-ink-muted">Note to the chair</Kicker>
        <p className="mt-2 text-[16px] font-medium leading-[1.5] text-[#39342c]">
          {latest.note?.trim()
            ? latest.note
            : "No note recorded for this week yet. A line of reflection — what compounded, what gave a little back — lands here."}
        </p>
      </div>

      {/* Area stats */}
      <div className="mt-6 grid grid-cols-3">
        {AREAS.map((a, i) => {
          const cents = areaContribs[a.key] ?? 0;
          return (
            <div key={a.key} className={i > 0 ? "border-l border-hairline-strong pl-4" : ""}>
              <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-muted">{a.label}</div>
              <div className={`mt-1.5 font-mono text-[17px] font-semibold tabular-nums ${tone(cents)}`}>
                {formatSignedDollars(cents)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Resolutions for next week */}
      <div className="mt-7">
        <Kicker className="tracking-[0.12em] text-ink-muted">Resolutions for next week</Kicker>
        {resolutions && resolutions.length > 0 ? (
          <div className="mt-3 space-y-2">
            {resolutions.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-card-sm border border-hairline bg-surface px-4 py-3">
                <span
                  aria-hidden
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border ${
                    r.checked ? "border-ink bg-accent text-accent-text" : "border-ink-faint"
                  }`}
                >
                  {r.checked ? <span className="text-[10px] leading-none">✓</span> : null}
                </span>
                <span className="text-[13px] text-ink">{r.text}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2.5 text-[13px] text-ink-muted">
            None set yet. Resolutions you carry into next week will appear here.
          </p>
        )}
      </div>

      {/* Footer — the next statement opens automatically when the week closes. */}
      <p className="mt-8 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
        Next statement opens when the week closes
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto min-h-full max-w-[460px] px-5 pt-3">{children}</div>;
}

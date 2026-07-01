import Link from "next/link";
import { addDays } from "@/lib/price/dates";
import { formatLocalDate, formatSignedDollars } from "@/lib/utils";

// PendingSettlement — Home's grace-window card. Home renders it ONLY when the engine
// returns state.pendingSettlement, which is non-null solely on the single grace day
// after a week closes. The just-closed week is already scored and folded into the
// displayed value, but it is NOT locked yet: the user keeps this day to log or fix it
// on Systems before it settles at their local midnight. This is the founder's
// "Option B" — the new week runs live (Today/RegionMap above) while last week sits
// here, editable, settling tonight. Pure presentation over the engine-derived shape.

export function PendingSettlement({
  weekEnd,
  markCents,
}: {
  weekEnd: string;
  markCents: number;
}) {
  const weekStart = addDays(weekEnd, -6);
  const range = `${formatLocalDate(weekStart, { month: "short", day: "numeric" })}–${formatLocalDate(
    weekEnd,
    { month: "short", day: "numeric" },
  )}`;
  const markTone =
    markCents > 0 ? "text-positive" : markCents < 0 ? "text-danger" : "text-ink-soft";

  return (
    <section className="mt-4">
      <div className="rounded-card border border-hairline bg-surface p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft">
            Last week · {range}
          </span>
          <span className={`font-mono text-[13px] font-semibold tabular-nums ${markTone}`}>
            {formatSignedDollars(markCents)}
          </span>
        </div>
        <p className="mt-1.5 text-[13.5px] font-semibold leading-tight text-ink">
          Settles tonight — still editable
        </p>
        <p className="mt-1 text-[12.5px] font-medium leading-[1.5] text-ink-soft">
          This result isn&apos;t locked in yet. Log or fix last week on{" "}
          <Link href="/habits" className="text-ink underline">
            Systems
          </Link>{" "}
          (use the day picker) before it settles at midnight.
        </p>
      </div>
    </section>
  );
}

"use client";

import { useState } from "react";
import { CategoryBadge, badgeKindFor } from "@/components/ui/category-badge";
import { LogToggle, clientToday } from "@/components/habits/log-toggle";

// TodayHabits — Home's daily tracking row. One compact line per active habit
// (morning, evening, mission, then the vice) with a tap-to-log control for TODAY.
// The authoritative logged-state comes from the server (loggedToday); each tap
// POSTs then router.refresh()es to reconcile (no client-side optimistic update).
// LogToggle runs in `live` mode so a tap re-derives the local day at tap time —
// a session left open across midnight logs the new day, not the stale one. An
// aria-live region announces each save, mirroring the roster's status pattern.

export interface TodayHabitView {
  habitId: string;
  kind: "asset" | "liability";
  cadence: string | null;
  area: string | null;
  title: string;
}

// Display order: morning, evening, mission, then the vice.
const CADENCE_ORDER: Record<string, number> = { morning: 0, evening: 1, mission: 2 };

function sortKey(h: TodayHabitView): number {
  if (h.kind === "liability") return 10;
  return CADENCE_ORDER[h.cadence ?? ""] ?? 3;
}

export function TodayHabits({
  habits,
  loggedToday,
}: {
  habits: TodayHabitView[];
  loggedToday: string[];
}) {
  const [status, setStatus] = useState("");
  const loggedSet = new Set(loggedToday);
  const { localDate } = clientToday();

  const ordered = [...habits].sort((a, b) => sortKey(a) - sortKey(b));

  if (ordered.length === 0) {
    return (
      <section className="mt-6">
        <h2 className="px-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft">
          Today
        </h2>
        <div className="mt-2.5 rounded-card border border-hairline bg-surface p-5">
          <p className="text-[14px] font-medium leading-[1.5] text-ink-soft">
            No habits yet. Add them on the Systems tab — each one becomes a daily check-in here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-6">
      <h2 className="px-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft">
        Today
      </h2>
      <div className="mt-2.5 divide-y divide-divider">
        {ordered.map((h) => (
          <div key={h.habitId} className="flex items-center gap-3 py-2.5">
            <CategoryBadge kind={badgeKindFor(h.kind, h.cadence)} />
            <p
              className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink"
              title={h.title}
            >
              {h.title}
            </p>
            <LogToggle
              habitId={h.habitId}
              kind={h.kind}
              title={h.title}
              logged={loggedSet.has(h.habitId)}
              live
              localDate={localDate}
              locked={false}
              dateLabel="today"
              onResult={setStatus}
            />
          </div>
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}

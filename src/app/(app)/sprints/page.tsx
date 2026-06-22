import { getAuthUser, createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { getOperatingState } from "@/lib/price/runner";
import type { ActiveSprintView, QueuedSprintView, ClosedSprintView } from "./sprints-board";
import { StrategyScreen, type YearGoalView } from "./strategy-screen";

// Strategy — the year GOAL + the goal SPRINT, each collapsible. The operating
// value, the active/queued cards (day-of-term, unrealized "if closed today") all
// come from getOperatingState — the same server-derived source Home uses; the
// client never computes the figures. This page additionally loads the single
// active year goal, the active sprint's task checklist, and the closed history.
export default async function StrategyPage() {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  let basisCents = 0;
  let goal: YearGoalView | null = null;
  let active: ActiveSprintView | null = null;
  let queued: QueuedSprintView[] = [];
  let closed: ClosedSprintView[] = [];
  let failed = false;

  try {
    // getOperatingState runs under the service role: pass the auth'd id only.
    const state = await getOperatingState(user.id);
    basisCents = state.displayedCents;
    queued = state.sprints.queued.map((s) => ({
      sprintId: s.sprintId,
      size: s.size,
      area: s.area,
      thesis: s.thesis,
      termDays: s.termDays,
      startsInDays: s.startsInDays ?? 0,
    }));

    const supabase = await createClient();

    // The user's single active year goal (newest active row). .error before data
    // (maybeSingle returns null/no-error when legitimately absent — only a real
    // read error throws into the failed-state UI).
    const { data: goalRow, error: goalErr } = await supabase
      .from("year_goals")
      .select("title, area, description, target_date")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (goalErr) throw goalErr;
    if (goalRow) {
      goal = {
        title: goalRow.title ?? "",
        area: goalRow.area ?? "",
        description: goalRow.description ?? "",
        targetDate: goalRow.target_date ?? "",
      };
    }

    const a = state.sprints.active;
    // The active sprint's task checklist already comes from getOperatingState
    // (state.sprints.active.tasks) — no separate sprint_tasks query needed here.
    const { data: closedData, error: closedErr } = await supabase
      .from("sprints")
      .select("id, size, area, thesis, realized_band, realized_amount_cents, goal_achieved, closed_at")
      .eq("user_id", user.id)
      .eq("status", "closed")
      .order("closed_at", { ascending: false })
      .limit(10);
    if (closedErr) throw closedErr;

    if (a) {
      active = {
        sprintId: a.sprintId,
        size: a.size,
        area: a.area,
        thesis: a.thesis,
        termDays: a.termDays,
        dayOfTerm: a.dayOfTerm ?? 0,
        completedTasks: a.completedTasks,
        totalTasks: a.totalTasks,
        unrealizedReturnCents: a.unrealizedReturnCents ?? 0,
        tasks: a.tasks,
      };
    }
    closed = (closedData ?? []).map((c) => ({
      id: c.id,
      size: c.size,
      area: c.area,
      thesis: c.thesis,
      realizedBand: c.realized_band,
      realizedAmountCents: c.realized_amount_cents,
      goalAchieved: c.goal_achieved,
      closedAt: c.closed_at,
    }));
  } catch (err) {
    // Reads here feed getOperatingState (which settles the permanent ledger) —
    // capture so a load failure surfaces instead of silently showing the fallback.
    Sentry.captureException(err, { tags: { area: "price", kind: "strategy_load_failed" } });
    failed = true;
  }

  if (failed) {
    return (
      <div className="mx-auto min-h-full max-w-[460px] px-[18px] pt-3">
        <StrategyHeader />
        <div className="mt-6 rounded-card border border-liability-border bg-liability-bg p-5">
          <p className="text-[14px] font-medium leading-[1.5] text-ink-soft">
            We couldn&apos;t load your strategy just now. Refresh in a moment — nothing was lost.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-full max-w-[460px] px-[18px] pt-3 pb-12">
      <StrategyHeader />
      <div className="mt-5">
        <StrategyScreen
          goal={goal}
          basisCents={basisCents}
          active={active}
          queued={queued}
          closed={closed}
        />
      </div>
    </div>
  );
}

function StrategyHeader() {
  return (
    <>
      <h1 className="font-display text-[24px] font-extrabold leading-none tracking-[-0.02em] text-ink">
        Strategy
      </h1>
      <p className="mt-1 text-[12px] font-medium text-ink-soft">
        Your year goal and the sprints that compound toward it.
      </p>
    </>
  );
}

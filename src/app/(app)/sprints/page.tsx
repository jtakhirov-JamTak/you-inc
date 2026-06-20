import { getAuthUser, createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getOperatingState } from "@/lib/price/runner";
import { SprintsBoard, type ActiveSprintView, type QueuedSprintView, type ClosedSprintView } from "./sprints-board";

// Sprints — investments (spec §Sprints + design handoff gold treatment). The
// operating value, the active/queued cards (day-of-term, unrealized "if closed
// today") all come from getOperatingState — the same server-derived source Home
// uses; the client never computes the figures. This page additionally loads the
// active sprint's task checklist and the closed-sprint history.
export default async function SprintsPage() {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  let basisCents = 0;
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
    const a = state.sprints.active;
    const [tasksRes, closedRes] = await Promise.all([
      a
        ? supabase
            .from("sprint_tasks")
            .select("id, title, done, position, due_day")
            .eq("sprint_id", a.sprintId)
            .order("position", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("sprints")
        .select("id, size, area, thesis, realized_band, realized_amount_cents, goal_achieved, closed_at")
        .eq("user_id", user.id)
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(10),
    ]);

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
        tasks: (tasksRes.data ?? []).map((t) => ({
          id: t.id,
          title: t.title,
          done: t.done,
          dueDay: t.due_day,
        })),
      };
    }
    closed = (closedRes.data ?? []).map((c) => ({
      id: c.id,
      size: c.size,
      area: c.area,
      thesis: c.thesis,
      realizedBand: c.realized_band,
      realizedAmountCents: c.realized_amount_cents,
      goalAchieved: c.goal_achieved,
      closedAt: c.closed_at,
    }));
  } catch {
    failed = true;
  }

  if (failed) {
    return (
      <div className="mx-auto min-h-full max-w-[460px] px-[18px] pt-3">
        <SprintsHeader />
        <div className="mt-6 rounded-card border border-liability-border bg-liability-bg p-5">
          <p className="text-[14px] font-medium leading-[1.5] text-ink-soft">
            We couldn&apos;t load your sprints just now. Refresh in a moment — nothing was lost.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-full max-w-[460px] px-[18px] pt-3 pb-12">
      <SprintsHeader />
      <SprintsBoard basisCents={basisCents} active={active} queued={queued} closed={closed} />
    </div>
  );
}

function SprintsHeader() {
  return (
    <>
      <h1 className="font-display text-[30px] font-extrabold leading-none tracking-[-0.03em] text-ink">
        Sprints
      </h1>
      <p className="mt-2 text-[13px] text-ink-soft">
        Investments toward your year goals — 10–14 day pushes that create growth.
      </p>
    </>
  );
}

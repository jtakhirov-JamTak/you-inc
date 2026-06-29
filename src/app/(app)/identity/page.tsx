import { getAuthUser, createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Kicker } from "@/components/ui/kicker";
import { IdentityScreen } from "./identity-screen";
import type { ValueRow, ModeRow, ModeKey, AffRow } from "./identity-charter";

const MODE_ORDER: ModeKey[] = ["baseline", "close_people", "under_pressure"];

// Identity — the charter (spec §Identity). All content is user-authored and
// editable; nothing is system-generated. We read whatever exists and pad to the
// fixed shape (3 values · 3 modes) so the form always renders the full charter.
export default async function IdentityPage() {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const [profileRes, valuesRes, modesRes, affRes] = await Promise.all([
    supabase
      .from("identity_profile")
      .select("mission, mission_habit_id")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("identity_values")
      .select("position, title, meaning")
      .eq("user_id", user.id)
      .order("position", { ascending: true }),
    supabase
      .from("identity_modes")
      .select("mode_key, mode_name, description")
      .eq("user_id", user.id),
    supabase
      .from("identity_affirmations")
      .select("affirmation, visualization")
      .eq("user_id", user.id)
      .order("position", { ascending: true }),
  ]);

  const mission = profileRes.data?.mission ?? "";

  // The Mission habit — the per-day asset (cadence 'mission') linked from the
  // identity profile. Fetch it only when linked, and only surface it if it's
  // still active (a replaced/retired one shouldn't show as current).
  let missionHabit: { title: string; area: string | null; termDays: number | null } | null =
    null;
  let missionHabitError = false;
  const missionHabitId = profileRes.data?.mission_habit_id ?? null;
  if (!profileRes.error && missionHabitId) {
    const habitRes = await supabase
      .from("habits")
      .select("title, area, term_days, status")
      .eq("id", missionHabitId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (habitRes.error) {
      missionHabitError = true;
    } else if (habitRes.data && habitRes.data.status === "active") {
      missionHabit = {
        title: habitRes.data.title,
        area: habitRes.data.area,
        termDays: habitRes.data.term_days,
      };
    }
  }

  const loadError =
    profileRes.error ||
    valuesRes.error ||
    modesRes.error ||
    affRes.error ||
    missionHabitError;

  // Pad values to 3 by position; modes to the 3 fixed contexts in fixed order.
  const valueByPos = new Map((valuesRes.data ?? []).map((v) => [v.position, v]));
  const values: ValueRow[] = [1, 2, 3].map((pos) => {
    const v = valueByPos.get(pos);
    return { title: v?.title ?? "", meaning: v?.meaning ?? "" };
  });

  const modeByKey = new Map((modesRes.data ?? []).map((m) => [m.mode_key, m]));
  const modes: ModeRow[] = MODE_ORDER.map((key) => {
    const m = modeByKey.get(key);
    return { mode_key: key, mode_name: m?.mode_name ?? "", description: m?.description ?? "" };
  });

  const affirmations: AffRow[] = (affRes.data ?? []).map((a) => ({
    affirmation: a.affirmation,
    visualization: a.visualization,
  }));

  return (
    <div className="mx-auto min-h-full max-w-[460px] px-[18px] pt-3">
      {loadError ? (
        <>
          <header className="pt-1">
            <h1 className="font-display text-[24px] font-extrabold leading-none tracking-[-0.02em] text-ink">
              Mission
            </h1>
            <p className="mt-1 text-[12px] font-medium text-ink-soft">The charter you run on.</p>
          </header>
          <div className="mt-6 rounded-card border border-hairline bg-surface p-5">
            <Kicker as="h2">Couldn&apos;t load your charter</Kicker>
            <p className="mt-2 text-[14px] font-medium leading-[1.5] text-ink-soft">
              Refresh in a moment — nothing was lost.
            </p>
          </div>
        </>
      ) : (
        <IdentityScreen
          mission={mission}
          values={values}
          modes={modes}
          affirmations={affirmations}
          missionHabit={missionHabit}
        />
      )}
    </div>
  );
}

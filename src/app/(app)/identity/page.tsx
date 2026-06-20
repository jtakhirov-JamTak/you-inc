import { getAuthUser, createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Kicker } from "@/components/ui/kicker";
import {
  IdentityCharter,
  type ValueRow,
  type ModeRow,
  type ModeKey,
  type AffRow,
} from "./identity-charter";

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
  const [valuesRes, modesRes, affRes] = await Promise.all([
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

  const loadError = valuesRes.error || modesRes.error || affRes.error;

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
      <header className="pt-1">
        <h1 className="font-display text-[30px] font-extrabold leading-none tracking-[-0.03em] text-ink">
          Identity
        </h1>
        <p className="mt-1 text-[13px] font-medium text-ink-soft">
          The charter the company is run by.
        </p>
      </header>

      {loadError ? (
        <div className="mt-6 rounded-card border border-hairline bg-surface p-5">
          <Kicker as="h2">Couldn&apos;t load your charter</Kicker>
          <p className="mt-2 text-[14px] font-medium leading-[1.5] text-ink-soft">
            Refresh in a moment — nothing was lost.
          </p>
        </div>
      ) : (
        <IdentityCharter
          initialValues={values}
          initialModes={modes}
          initialAffirmations={affirmations}
        />
      )}
    </div>
  );
}

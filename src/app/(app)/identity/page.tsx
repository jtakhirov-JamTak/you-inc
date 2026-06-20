import { getAuthUser, createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { StormBackground } from "@/components/brand/StormBackground";
import { Kicker } from "@/components/ui/kicker";
import { Card } from "@/components/ui/card";
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
    <div className="relative min-h-full px-5 pt-4 pb-32">
      <StormBackground />

      <div className="mb-5 pt-2">
        <Kicker>The charter</Kicker>
        <h1
          className="mt-2 font-display text-[30px] font-medium leading-[1.1] text-ink"
          style={{ letterSpacing: "-0.6px" }}
        >
          Identity
        </h1>
        <p className="mt-1 text-[14px] font-medium text-ink-soft">
          Your values, how people experience you, and what you affirm.
        </p>
      </div>

      {loadError ? (
        <Card className="p-5" variant="warm">
          <Kicker as="h2">Couldn&apos;t load your charter</Kicker>
          <p className="mt-2 text-[14px] font-medium leading-[1.5] text-ink-soft">
            Refresh in a moment — nothing was lost.
          </p>
        </Card>
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

import { getAuthUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { StormBackground } from "@/components/brand/StormBackground";
import { readFirstName } from "@/lib/user-metadata";
import { Card } from "@/components/ui/card";
import { Kicker } from "@/components/ui/kicker";

// Authed home. Placeholder for the operating-health "price" screen — the score
// engine + domain surfaces land in Phase B. For now it confirms the foundation
// is wired and greets the user.
export default async function HomePage() {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const firstName = readFirstName(user.user_metadata);

  return (
    <div className="relative min-h-full px-5 pt-4 pb-32">
      <StormBackground />

      <div className="mb-6 pt-2">
        <Kicker>Operating health</Kicker>
        <h1
          className="mt-2 font-display text-[44px] font-medium leading-[1.05] text-ink"
          style={{ letterSpacing: "-1.2px" }}
        >
          $200,000
        </h1>
        <p className="mt-1 text-[14px] font-medium text-ink-soft">
          {firstName ? `Welcome, ${firstName}.` : "Welcome."} Your starting
          valuation.
        </p>
      </div>

      <Card className="p-5">
        <Kicker>Coming next</Kicker>
        <p className="mt-2 text-[14px] font-medium leading-[1.5] text-ink-soft">
          Identity, year goals, sprints, habits, regulation, and the Sunday
          board meeting are on the way. This is the foundation — the product
          gets built on top of it.
        </p>
      </Card>
    </div>
  );
}

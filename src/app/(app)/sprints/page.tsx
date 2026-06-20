import { getAuthUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Kicker } from "@/components/ui/kicker";

// Sprints — investments toward the year goals (10–14 day pushes). The detail
// screen is not in the design handoff yet; this is an on-theme placeholder so the
// tab resolves. The Home screen already surfaces the active + queued sprint cards
// and the price engine already books a sprint's realized return at close.
export default async function SprintsPage() {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto min-h-full max-w-[460px] px-[18px] pt-3">
      <h1 className="font-display text-[30px] font-extrabold leading-none tracking-[-0.03em] text-ink">
        Sprints
      </h1>
      <p className="mt-2 text-[13px] text-ink-soft">
        Investments toward your year goals — 10–14 day pushes that create growth.
      </p>

      <div className="mt-6 rounded-card border border-gold-border bg-gold-bg p-5">
        <Kicker className="tracking-[0.14em] text-gold-label">Coming soon</Kicker>
        <p className="mt-2.5 text-[14px] font-medium leading-[1.55] text-ink">
          Sprint planning lives here next: size the bet (small / medium / big), name the thesis,
          lay out the tasks, and set the term. Your return books to your operating value at close —
          basis is your balance when you set it, not the baseline.
        </p>
        <p className="mt-3 text-[13px] leading-[1.5] text-[#8a7a4e]">
          Until then, any active or queued sprint appears on your Home screen as an investment.
        </p>
      </div>
    </div>
  );
}

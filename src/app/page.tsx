import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Wordmark } from "@/components/brand/Wordmark";
import { PageBackground } from "@/components/brand/PageBackground";
import { cn } from "@/lib/utils";
import { pillAccentClass } from "@/components/ui/button";

export default async function LandingPage() {
  // Authed users don't belong on the marketing page — send them to the app.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    redirect("/home");
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-6 pb-[env(safe-area-inset-bottom)] pt-[max(3rem,env(safe-area-inset-top))]">
      <PageBackground />

      <div className="w-full max-w-sm text-center">
        <div className="flex justify-center">
          <Wordmark size={24} />
        </div>
        <h1
          className="mt-10 font-display text-[40px] font-medium leading-[1.05] text-ink"
          style={{ letterSpacing: "-1.2px" }}
        >
          Run yourself
          <br />
          like a <span className="italic">company</span>.
        </h1>
        <p className="mt-4 text-[15px] font-medium leading-[1.5] text-ink-soft">
          Set your goals, run your sprints, track the habits that move your
          operating health — and watch your number climb.
        </p>

        <Link
          href="/signup"
          className={cn(pillAccentClass, "mt-10 h-14 w-full text-[15px]")}
        >
          Get started
        </Link>

        <p className="mt-6 text-[13px] font-medium text-ink-soft">
          Already have an account?{" "}
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center px-2 text-[13px] font-semibold text-accent-ink underline active:opacity-70"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}

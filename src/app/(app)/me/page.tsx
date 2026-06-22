import { getAuthUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Settings, ChevronRight } from "lucide-react";
import { PageBackground } from "@/components/brand/PageBackground";
import { readFirstName } from "@/lib/user-metadata";
import { SignOutButton } from "@/components/sign-out-button";

// Me tab: account surfaces. Reading screen. Domain surfaces (Identity, etc.)
// link in here in Phase B.
const LINKS = [{ href: "/settings", label: "Settings", Icon: Settings }];

export default async function MePage() {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const firstName = readFirstName(user.user_metadata);

  return (
    <div className="relative min-h-full px-5 pt-4 pb-32">
      <PageBackground />

      <div className="mb-6 pt-2">
        <h1
          className="font-display text-[28px] font-medium leading-[1.1] text-ink sm:text-[34px]"
          style={{ letterSpacing: "-0.7px" }}
        >
          {firstName ? `${firstName}` : "Your account"}
        </h1>
        {user.email && (
          <p className="mt-1 text-[14px] font-medium text-ink-soft">
            {user.email}
          </p>
        )}
      </div>

      <div className="mt-4 divide-y divide-hairline overflow-hidden rounded-card border border-hairline bg-surface/70 shadow-dark">
        {LINKS.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex min-h-14 items-center gap-3 px-4 py-3.5 transition active:bg-surface-tint"
          >
            <Icon className="h-5 w-5 text-ink-soft" />
            <span className="flex-1 font-medium text-ink">{label}</span>
            <ChevronRight className="h-4 w-4 text-ink-soft" />
          </Link>
        ))}
      </div>

      <SignOutButton className="mt-4 flex min-h-14 w-full items-center gap-3 rounded-card border border-hairline bg-surface/70 px-4 py-3.5 shadow-dark transition active:bg-surface-tint" />
    </div>
  );
}

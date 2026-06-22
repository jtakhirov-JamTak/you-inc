import { getAuthUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageBackground } from "@/components/brand/PageBackground";
import { SettingsForm } from "./settings-form";
import { ExportData } from "./export-data";
import { DeleteAccount } from "./delete-account";

export default async function SettingsPage() {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const raw = user.user_metadata?.first_name;
  const currentFirstName =
    typeof raw === "string" ? raw.trim().slice(0, 50) : "";

  return (
    <div className="relative min-h-full px-5 pt-4 pb-32">
      <PageBackground />
      <h1
        className="font-display text-[30px] font-medium leading-[1.12] text-ink"
        style={{ letterSpacing: "-0.7px" }}
      >
        Settings
      </h1>
      <p className="mt-2 text-[14px] font-medium leading-[1.5] text-ink-soft">
        Your profile and preferences.
      </p>

      <div className="mt-6">
        <SettingsForm initialFirstName={currentFirstName} />
      </div>

      <div className="mt-6">
        <ExportData />
      </div>

      <div className="mt-6">
        <DeleteAccount />
      </div>
    </div>
  );
}

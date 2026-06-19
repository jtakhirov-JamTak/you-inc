import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { readFirstName } from "@/lib/user-metadata";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // getAuthUser is React.cache()-wrapped — shares the JWT validation
  // round trip with the page below.
  const {
    data: { user },
  } = await getAuthUser();

  // Middleware should have caught unauthed users, but be safe. This layout is an
  // auth gate only.
  if (!user) {
    redirect("/login");
  }

  return (
    <AppShell
      userEmail={user.email}
      firstName={readFirstName(user.user_metadata)}
    >
      {children}
    </AppShell>
  );
}

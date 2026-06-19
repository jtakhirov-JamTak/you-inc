"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogOut } from "lucide-react";

// Reusable client sign-out action. Mirrors the AppShell menu logout so the Me
// tab can offer Log Out without making the whole page a client component.
export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <button type="button" onClick={handleLogout} className={className}>
      <LogOut className="h-5 w-5 text-ink-soft" />
      <span className="font-medium text-ink">Log Out</span>
    </button>
  );
}

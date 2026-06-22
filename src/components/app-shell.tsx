"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ClipboardList, LogOut, Settings } from "lucide-react";

// The 5 product tabs (design handoff §Global System). Account surfaces (Settings)
// live under the top-right avatar menu, not a tab. Each tab carries a minimal
// geometric glyph; active = ink, inactive = faint. Sprints is routed but its
// detail screen is not designed yet (placeholder page).
type TabKey = "home" | "identity" | "sprints" | "habits" | "board";
const TABS: { href: string; label: string; key: TabKey; match: string[] }[] = [
  { href: "/home", label: "Home", key: "home", match: [] },
  { href: "/identity", label: "Mission", key: "identity", match: [] },
  { href: "/sprints", label: "Strategy", key: "sprints", match: [] },
  { href: "/habits", label: "Systems", key: "habits", match: [] },
];

// Monoline geometric glyphs — square / circle / diamond / bars / 2×2 dots.
// `currentColor` so the label/icon share the active-ink vs faint color.
function TabIcon({ tab, className }: { tab: TabKey; className?: string }) {
  const common = { className, fill: "none", stroke: "currentColor", strokeWidth: 1.6 };
  switch (tab) {
    case "home":
      return (
        <svg viewBox="0 0 20 20" width="20" height="20" {...common}>
          <rect x="4" y="4" width="12" height="12" rx="2.5" />
        </svg>
      );
    case "identity":
      return (
        <svg viewBox="0 0 20 20" width="20" height="20" {...common}>
          <circle cx="10" cy="10" r="6.2" />
        </svg>
      );
    case "sprints":
      return (
        <svg viewBox="0 0 20 20" width="20" height="20" {...common}>
          <rect x="10" y="3.2" width="9.6" height="9.6" rx="1.8" transform="rotate(45 10 10)" />
        </svg>
      );
    case "habits":
      return (
        <svg viewBox="0 0 20 20" width="20" height="20" {...common} strokeLinecap="round">
          <line x1="5" y1="13.5" x2="5" y2="9" />
          <line x1="10" y1="13.5" x2="10" y2="5.5" />
          <line x1="15" y1="13.5" x2="15" y2="11" />
        </svg>
      );
    case "board":
      return (
        <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" className={className}>
          <circle cx="7" cy="7" r="1.9" />
          <circle cx="13" cy="7" r="1.9" />
          <circle cx="7" cy="13" r="1.9" />
          <circle cx="13" cy="13" r="1.9" />
        </svg>
      );
  }
}

// useLinkStatus must be called inside a descendant of <Link>. `pending` flips
// true the instant the Link is tapped so active styles apply within one frame.
function Tab({ tab, isActive }: { tab: (typeof TABS)[number]; isActive: boolean }) {
  const { pending } = useLinkStatus();
  const showActive = isActive || pending;
  return (
    <span
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-1 pt-[9px] transition-colors duration-150",
        showActive ? "text-ink" : "text-ink-faint",
      )}
    >
      <TabIcon tab={tab.key} />
      <span
        className={cn(
          "text-[9.5px] tracking-[0.02em]",
          showActive ? "font-semibold" : "font-medium",
        )}
      >
        {tab.label}
      </span>
    </span>
  );
}

function avatarInitial(
  firstName: string | null | undefined,
  email: string | null | undefined,
): string {
  const fn = firstName?.trim();
  if (fn) return fn.charAt(0).toUpperCase();
  if (!email) return "?";
  const prefix = email.split("@")[0] ?? "";
  const ch = prefix.charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

export function AppShell({
  children,
  userEmail,
  firstName,
}: {
  children: React.ReactNode;
  userEmail?: string | null;
  firstName?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="relative flex min-h-dvh flex-col">
      {/* Top-right account menu. Each screen renders its own header/title in its
          content; the only shared top chrome is the avatar. */}
      <header
        data-app-chrome
        className="relative z-20 flex shrink-0 items-center justify-end px-[18px] pb-1 pt-[max(env(safe-area-inset-top),1rem)]"
      >
        <div className="relative">
          <button
            type="button"
            aria-label="Open account menu"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-hairline bg-surface text-[13px] font-bold text-ink transition active:scale-95"
          >
            {avatarInitial(firstName, userEmail)}
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onPointerDown={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-50 mt-2 w-48 rounded-[14px] border border-hairline bg-surface py-1 shadow-card">
                <Link
                  href="/board"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-ink-soft hover:bg-surface-tint"
                >
                  <ClipboardList className="h-4 w-4" />
                  Board
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-ink-soft hover:bg-surface-tint"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-medium text-ink-soft hover:bg-surface-tint"
                >
                  <LogOut className="h-4 w-4" />
                  Log Out
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* Page content */}
      <main className="relative z-10 flex-1 overflow-y-auto pb-[calc(5rem+env(safe-area-inset-bottom))]">
        {children}
      </main>

      {/* Bottom tab bar — full-width, white, 1px top hairline (design handoff). */}
      <nav
        data-app-chrome
        className="fixed bottom-0 left-0 right-0 z-30 flex border-t border-hairline bg-surface pb-[env(safe-area-inset-bottom)]"
        aria-label="Primary"
      >
        {TABS.map((tab) => {
          const isActive =
            pathname === tab.href ||
            pathname.startsWith(tab.href + "/") ||
            tab.match.some((m) => pathname === m || pathname.startsWith(m + "/"));
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className="flex h-[58px] flex-1 active:opacity-70"
            >
              <Tab tab={tab} isActive={isActive} />
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

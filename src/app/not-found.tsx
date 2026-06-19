import Link from "next/link";
import { StormBackground } from "@/components/brand/StormBackground";
import { cn } from "@/lib/utils";
import { pillAccentClass } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-5">
      <StormBackground />
      <p className="font-display text-6xl font-medium text-ink-soft">404</p>
      <p className="mt-4 text-base font-semibold text-ink">Page not found</p>
      <p className="mt-1 text-sm font-medium text-ink-soft">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link
        href="/"
        className={cn(pillAccentClass, "mt-6 h-12 px-6 text-sm")}
      >
        Back home
      </Link>
    </div>
  );
}

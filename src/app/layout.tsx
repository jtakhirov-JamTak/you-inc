import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Spec type system (you-inc-spec.md §Design system): Schibsted Grotesk for
// display (800) + UI/body (400–600), JetBrains Mono for figures only (the
// price, deltas, timers). No serif.
const schibsted = Schibsted_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
  variable: "--font-schibsted",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximumScale — pinch-zoom must stay enabled (WCAG 1.4.4). Locking it to 1
  // blocks low-vision users from zooming. iOS input-zoom is handled by 16px+
  // font-size on inputs instead, not by disabling zoom.
  viewportFit: "cover",
  themeColor: "#FAF3EC",
};

export const metadata: Metadata = {
  title: "You, Inc.",
  description:
    "Run yourself like a company. Set goals, run sprints, and track the habits that move your operating health.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "You, Inc.",
  },
  openGraph: {
    title: "You, Inc.",
    description:
      "Run yourself like a company. Set goals, run sprints, and track the habits that move your operating health.",
    type: "website",
  },
  // `apple` intentionally omitted — Next.js picks up `app/apple-icon.tsx`
  // and serves a PNG, which iOS requires (it ignores SVG apple-touch-icons).
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${schibsted.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}

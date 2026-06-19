import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Storm theme type system: Hanken Grotesk for body + headings (headings at
// weight 500, not bold), IBM Plex Mono for the uppercase kicker/labels/timers
// that are the signature of the system.
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-hanken",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximumScale — pinch-zoom must stay enabled (WCAG 1.4.4). Locking it to 1
  // blocks low-vision users from zooming. iOS input-zoom is handled by 16px+
  // font-size on inputs instead, not by disabling zoom.
  viewportFit: "cover",
  themeColor: "#0F1825",
};

export const metadata: Metadata = {
  title: "You, Inc.",
  description:
    "Run yourself like a company. Set goals, run sprints, and track the habits that move your operating health.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
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
      className={`h-full antialiased ${hanken.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}

import { ImageResponse } from "next/og";

// iOS Safari ignores SVG apple-touch-icon and falls back to a page screenshot.
// Next.js `app/apple-icon.tsx` convention renders this component to a PNG at
// build time, served at `/apple-icon?v=...`, which iOS picks up automatically.
// Text-free on purpose — the OS label already shows "You, Inc." under the icon.

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            "linear-gradient(180deg, #D6EEFF 0%, #A9D9FF 55%, #4FB0FF 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width="140"
          height="140"
          viewBox="0 0 180 180"
          xmlns="http://www.w3.org/2000/svg"
        >
          <ellipse cx="90" cy="128" rx="62" ry="8" fill="#0E2748" opacity="0.14" />
          <circle cx="50" cy="86" r="28" fill="#FFFFFF" />
          <circle cx="80" cy="62" r="36" fill="#FFFFFF" />
          <circle cx="114" cy="72" r="30" fill="#FFFFFF" />
          <circle cx="132" cy="92" r="22" fill="#FFFFFF" />
          <rect x="40" y="86" width="104" height="30" rx="15" fill="#FFFFFF" />
          <ellipse cx="90" cy="112" rx="54" ry="8" fill="#E8F1FB" opacity="0.7" />
          <circle cx="58" cy="68" r="6" fill="#FFFFFF" opacity="0.9" />
          <circle cx="76" cy="78" r="2.8" fill="#0E2748" />
          <circle cx="104" cy="78" r="2.8" fill="#0E2748" />
          <path
            d="M82 88 Q90 94 98 88"
            stroke="#0E2748"
            strokeWidth="2.6"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}

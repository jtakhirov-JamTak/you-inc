import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format a date string for display, timezone-safe. A BARE "YYYY-MM-DD" is a
// calendar date with no instant — `new Date("2026-04-20")` parses it as UTC
// midnight, which renders the PREVIOUS day for users west of UTC. So date-only
// inputs are split into local-date parts. A full ISO timestamp (with a time
// component) is a real instant — it falls through to `new Date(input)` and is
// rendered in the user's local timezone (correct). The regex is ANCHORED so an
// ISO string does NOT match the date-only branch.
export function formatLocalDate(
  input: string,
  opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  },
): string {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  const d = ymd
    ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]))
    : new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  return d.toLocaleDateString("en-US", opts);
}

// crypto.randomUUID only exists in secure contexts (https / localhost).
// Dev-testing over HTTP on LAN hits non-secure context and crashes the page.
// Idempotency keys need uniqueness, not cryptographic strength.
export function safeUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

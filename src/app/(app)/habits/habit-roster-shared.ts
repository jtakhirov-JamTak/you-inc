// Shared leaf utilities for the Habits roster — types, pickers' option constants,
// and the stored-recurrence parsers. Imported by both habit-roster.tsx (the
// orchestrator + cards) and habit-forms.tsx (the create/edit forms); this module
// imports from neither, so there is no cycle.
import type { Cadence } from "@/lib/habits/roster";
import type { RecurrenceRule } from "@/lib/price/recurrence";

export interface HabitView {
  id: string;
  kind: "asset" | "liability";
  cadence: Cadence | null;
  area: "health" | "wealth" | "relationships" | null;
  title: string;
  term_days: number | null;
  // jsonb (weekly assets only): { type:'weekdays', days } | { type:'every_n_days', n, anchor }.
  recurrence_rule: unknown;
}

export const TERMS = [7, 14, 30, 60] as const;
export const AREAS = ["health", "wealth", "relationships"] as const;
export const WEEKDAYS = [
  { d: 0, label: "S" },
  { d: 1, label: "M" },
  { d: 2, label: "T" },
  { d: 3, label: "W" },
  { d: 4, label: "T" },
  { d: 5, label: "F" },
  { d: 6, label: "S" },
] as const;
// Full names so the single-letter day toggles aren't ambiguous to screen readers.
export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const CADENCE_COPY: Record<Cadence, { tag: string; hint: string }> = {
  morning: { tag: "Morning", hint: "Your one keystone morning habit." },
  daily: { tag: "Daily", hint: "The habit you repeat every day." },
  weekly: { tag: "Weekly", hint: "A recurring weekly commitment." },
};

// Parse the stored jsonb recurrence into the engine's RecurrenceRule (mirrors
// price/weeks.ts parseRule), so the UI can ask isScheduledOn for the selected day.
export function parseRule(raw: unknown): RecurrenceRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.type === "weekdays" && Array.isArray(r.days)) {
    return { type: "weekdays", days: r.days.map(Number) };
  }
  if (r.type === "every_n_days" && typeof r.n === "number" && typeof r.anchor === "string") {
    return { type: "every_n_days", n: r.n, anchor: r.anchor };
  }
  return null;
}

// The weekdays of a stored rule, as a list (for pre-filling the edit picker).
export function ruleDays(raw: unknown): number[] {
  const rule = parseRule(raw);
  return rule?.type === "weekdays" ? rule.days : [];
}

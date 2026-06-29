// Shared leaf utilities for the Habits roster — types and the pickers' option
// constants. Imported by both habit-roster.tsx (the orchestrator + cards) and
// habit-forms.tsx (the create/edit forms); this module imports from neither, so
// there is no cycle.
import type { Cadence } from "@/lib/habits/roster";

export interface HabitView {
  id: string;
  kind: "asset" | "liability";
  cadence: Cadence | null;
  area: "health" | "wealth" | "relationships" | null;
  title: string;
  term_days: number | null;
}

export const TERMS = [7, 14, 30, 60] as const;
export const AREAS = ["health", "wealth", "relationships"] as const;

export const CADENCE_COPY: Record<Cadence, { tag: string; hint: string }> = {
  morning: { tag: "Morning", hint: "Your one keystone morning habit." },
  evening: { tag: "Evening", hint: "The habit that closes your day." },
  mission: { tag: "Mission", hint: "Your mission habit — managed from Mission." },
};

// The Mission habit is authored on the Mission tab, not added as a Systems slot.
export const SYSTEMS_ASSET_CADENCES = ["morning", "evening"] as const;

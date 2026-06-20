// App-level shared types. Domain types (Identity, Goals, Sprints, Habits,
// Regulation, Board Meeting, the score/price engine) are added in Phase B
// alongside the migrations that back them.

// Banned AI phrases — checked before displaying any AI output (carried over as a
// reusable guardrail; wire into the AI output validator when AI lands).
export const BANNED_PHRASES = [
  "You are someone who",
  "Deep down",
  "You fear",
  "Your wound is",
  "Your trauma response is",
  "Subconsciously",
  "This means you have",
] as const;

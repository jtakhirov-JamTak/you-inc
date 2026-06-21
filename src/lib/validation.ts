// Zod request schemas. One per endpoint; add domain schemas (Identity, Goals,
// Sprints, Habits, etc.) here in Phase B as their endpoints land.
import { z } from "zod";

// Account deletion — irreversible hard delete. The literal "DELETE" must be
// typed to confirm; the schema enforces it server-side so a malformed/automated
// POST without the exact confirmation word is rejected before any delete runs.
export const deleteAccountSchema = z.object({
  confirm: z.literal("DELETE"),
});

// A real IANA timezone name. The price engine derives "what local day is it" and
// when a week elapses from this string (via Intl) — a bogus value would throw on
// read and blank the home value, so it's validated strictly before being stored.
// Intl.DateTimeFormat throws a RangeError on an unknown zone; a valid one doesn't.
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Update the user's settlement timezone — sent by the client's TimezoneSync on app
// load (the browser's own Intl zone). Bounded length + IANA validity guard the
// engine's date math.
export const updateTimezoneSchema = z.object({
  timezone: z.string().min(1).max(64).refine(isValidTimeZone, "Invalid timezone"),
});
export type UpdateTimezoneInput = z.infer<typeof updateTimezoneSchema>;

// A 'YYYY-MM-DD' that is also a real calendar date (rejects 2026-13-45,
// 2026-02-30). The regex alone would let impossible dates through.
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((d) => {
    const [y, m, day] = d.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, day));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === day
    );
  }, "Invalid calendar date");

// Habit logging — append one raw per-day completion (asset) or relapse
// (liability) to habit_logs. The client mints `sourceSessionId` once per tap
// and resends it on retry; the real dedup is the natural key
// (user, habit, localDate). `localDate` + `occurredTz` are the user's local
// calendar date and IANA zone captured at write time. `status` is NOT accepted
// from the client — the server derives done/relapse from the habit's kind.
// `action` toggles: "log" appends, "undo" removes that day's row.
export const habitLogSchema = z.object({
  habitId: z.string().uuid(),
  localDate: calendarDate,
  occurredTz: z.string().min(1).max(64),
  sourceSessionId: z.string().uuid(),
  action: z.enum(["log", "undo"]).default("log"),
  note: z.string().max(2000).optional(),
});
export type HabitLogInput = z.infer<typeof habitLogSchema>;

// Habit creation. The roster has a FIXED shape (1 morning + 1 daily + 1 weekly
// asset + 2 vices); the cap is enforced server-side against the live roster (see
// validateRosterAddition) — these schemas only validate one habit's own fields.
//
// Recurrence is for the weekly slot only. The client picks weekdays or "every N
// days"; the server stamps the `anchor` for every_n_days (so the client need not
// know the habit's start date). Both forms are constrained to guarantee ≥1
// scheduled occurrence per calendar week (weekdays: ≥1 day; every_n_days: n≤7).
const weekdaysRule = z
  .object({
    type: z.literal("weekdays"),
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  })
  .refine((r) => new Set(r.days).size === r.days.length, "Duplicate weekdays");
const everyNDaysRule = z.object({
  type: z.literal("every_n_days"),
  n: z.number().int().min(1).max(7),
});
export const recurrenceInputSchema = z.discriminatedUnion("type", [
  weekdaysRule,
  everyNDaysRule,
]);
export type RecurrenceInput = z.infer<typeof recurrenceInputSchema>;

const habitArea = z.enum(["health", "wealth", "relationships"]);
const habitTitle = z.string().trim().min(1).max(80);

// Identity — the charter (spec §Identity). All user-authored, saved as a whole.
// Values are exactly 3 (positions 1–3); modes are the 3 fixed contexts;
// affirmations are 0–7 { affirmation, visualization } pairs. Every field is
// required-non-empty when present — a partial draft is enforced client-side
// (Save stays disabled), so anything that reaches here is a complete charter.
const identityValue = z.object({
  position: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  title: z.string().trim().min(1).max(60),
  meaning: z.string().trim().min(1).max(300),
});
const identityMode = z.object({
  mode_key: z.enum(["baseline", "close_people", "under_pressure"]),
  mode_name: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(200),
});
const identityAffirmation = z.object({
  affirmation: z.string().trim().min(1).max(300),
  visualization: z.string().trim().min(1).max(300),
});
export const saveIdentitySchema = z.object({
  values: z
    .array(identityValue)
    .length(3)
    .refine(
      (vs) => new Set(vs.map((v) => v.position)).size === vs.length,
      "Duplicate value positions",
    ),
  modes: z
    .array(identityMode)
    .length(3)
    .refine(
      (ms) => new Set(ms.map((m) => m.mode_key)).size === ms.length,
      "Duplicate mode keys",
    ),
  affirmations: z.array(identityAffirmation).max(7),
});
export type SaveIdentityInput = z.infer<typeof saveIdentitySchema>;

// Sprints — time-boxed investments (spec §Sprints). One active at a time + a
// sequential queue. `tasks` are the controllable checklist whose completion ratio
// drives the payoff band; the set-time balance + locked dollar grid are frozen
// server-side at create (never client-supplied). 1–12 tasks keeps the grid legible.
const sprintArea = z.enum(["health", "wealth", "relationships"]);
// Each task carries a milestone day (1-based, within the term). The live
// unrealized return only counts a task against you once its milestone day has
// ended undone (M2). dueDay ≤ termDays is enforced by the object-level refine.
const sprintTask = z.object({
  title: z.string().trim().min(1).max(120),
  dueDay: z.number().int().min(1).max(14),
});
export const createSprintSchema = z
  .object({
    size: z.enum(["small", "medium", "big"]),
    area: sprintArea,
    thesis: z.string().trim().min(1).max(280),
    termDays: z.number().int().min(10).max(14),
    tasks: z.array(sprintTask).min(1).max(12),
  })
  .refine((s) => s.tasks.every((t) => t.dueDay <= s.termDays), {
    message: "A task milestone falls after the sprint term.",
    path: ["tasks"],
  });
export type CreateSprintInput = z.infer<typeof createSprintSchema>;

// Toggle one task's done state. `done` is the DESIRED state (not a flip), so a
// double-send is idempotent. Ownership + the active-sprint guard are server-side.
export const sprintTaskToggleSchema = z.object({
  taskId: z.string().uuid(),
  done: z.boolean(),
});
export type SprintTaskToggleInput = z.infer<typeof sprintTaskToggleSchema>;

// Close the active sprint → book its realized return. `goalAchieved` is the
// user's call at close (the upside-only year-goal bonus). Idempotency is the
// ledger's sprint_realized key + the server's active-status guard.
export const closeSprintSchema = z.object({
  sprintId: z.string().uuid(),
  goalAchieved: z.boolean().default(false),
});
export type CloseSprintInput = z.infer<typeof closeSprintSchema>;

export const createHabitSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("asset"),
      cadence: z.enum(["morning", "daily", "weekly"]),
      title: habitTitle,
      area: habitArea.optional(),
      termDays: z.union([
        z.literal(7),
        z.literal(14),
        z.literal(30),
        z.literal(60),
      ]),
      recurrence: recurrenceInputSchema.optional(),
    })
    // The weekly slot REQUIRES a recurrence; morning/daily must NOT carry one.
    .refine(
      (h) => (h.cadence === "weekly" ? !!h.recurrence : !h.recurrence),
      {
        message: "Weekly habits need a recurrence; others must not have one.",
        path: ["recurrence"],
      },
    ),
  z.object({
    kind: z.literal("liability"),
    title: habitTitle,
    area: habitArea.optional(),
  }),
]);
export type CreateHabitInput = z.infer<typeof createHabitSchema>;

// ── Board authoring ──────────────────────────────────────────────────────────
// The weekly statement's user-authored fields. The note and resolutions are
// narrative/checklist data — they do NOT feed the price engine, so they're freely
// editable (unlike append-only habit_logs / the ledger). Ownership is enforced by
// RLS (board_meetings owner UPDATE, board_resolutions owner full CRUD; migration
// 0009) plus an explicit user_id filter as defense-in-depth.

// Edit the "Note to the chair" on a given meeting. Empty string clears the note.
export const boardNoteSchema = z.object({
  meetingId: z.string().uuid(),
  note: z.string().max(800),
});
export type BoardNoteInput = z.infer<typeof boardNoteSchema>;

// Add a resolution to a meeting. `for_week_index` is derived server-side from the
// meeting's week_index — never client-supplied.
export const boardResolutionAddSchema = z.object({
  meetingId: z.string().uuid(),
  text: z.string().trim().min(1).max(200),
});
export type BoardResolutionAddInput = z.infer<typeof boardResolutionAddSchema>;

// Toggle one resolution's checked state. `checked` is the DESIRED state (not a
// flip), so a double-send is idempotent.
export const boardResolutionToggleSchema = z.object({
  resolutionId: z.string().uuid(),
  checked: z.boolean(),
});
export type BoardResolutionToggleInput = z.infer<
  typeof boardResolutionToggleSchema
>;

// Remove a resolution.
export const boardResolutionDeleteSchema = z.object({
  resolutionId: z.string().uuid(),
});
export type BoardResolutionDeleteInput = z.infer<
  typeof boardResolutionDeleteSchema
>;

// Generate (or return the cached) AI performance analysis for one meeting. The
// rolling window + facts are derived server-side from the user's own logs.
export const boardAnalysisSchema = z.object({
  meetingId: z.string().uuid(),
});
export type BoardAnalysisInput = z.infer<typeof boardAnalysisSchema>;

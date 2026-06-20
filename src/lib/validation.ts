// Zod request schemas. One per endpoint; add domain schemas (Identity, Goals,
// Sprints, Habits, etc.) here in Phase B as their endpoints land.
import { z } from "zod";

// Account deletion — irreversible hard delete. The literal "DELETE" must be
// typed to confirm; the schema enforces it server-side so a malformed/automated
// POST without the exact confirmation word is rejected before any delete runs.
export const deleteAccountSchema = z.object({
  confirm: z.literal("DELETE"),
});

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

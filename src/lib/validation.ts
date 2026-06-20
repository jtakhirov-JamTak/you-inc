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

// Zod request schemas. One per endpoint; add domain schemas (Identity, Goals,
// Sprints, Habits, etc.) here in Phase B as their endpoints land.
import { z } from "zod";

// Account deletion — irreversible hard delete. The literal "DELETE" must be
// typed to confirm; the schema enforces it server-side so a malformed/automated
// POST without the exact confirmation word is rejected before any delete runs.
export const deleteAccountSchema = z.object({
  confirm: z.literal("DELETE"),
});

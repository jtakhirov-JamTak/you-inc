-- 0020_year_goal_flow — the guided one-year-goal prompt flow's saved fields.
--
-- The Strategy "Goal" is authored through a 4-step flow (Domain → Future Scene →
-- Weekly Habit → Obstacle). Beyond the existing area/title/target_date, the flow
-- captures the future-self statement, observable proof, success metric, the weekly
-- proof behavior (which also spawns a weekly habit), the main obstacle, and two
-- if–then plans. All nullable: a goal authored before this migration (or via the
-- legacy quick-edit) is still valid with these blank. `weekly_habit_id` links the
-- goal to the weekly habit the flow created (set null if that habit is later
-- hard-deleted; status changes don't touch it).
--
-- Editable narrative content (not a log) — the existing owner RLS on year_goals
-- (0005) already governs these columns; adding columns needs no new policy.

alter table public.year_goals
  add column if not exists identity_statement text,
  add column if not exists observable_proof text,
  add column if not exists success_metric text,
  add column if not exists weekly_behavior text,
  add column if not exists obstacle text,
  add column if not exists if_then_1_trigger text,
  add column if not exists if_then_1_action text,
  add column if not exists if_then_2_trigger text,
  add column if not exists if_then_2_action text,
  add column if not exists weekly_habit_id uuid
    references public.habits (id) on delete set null;

notify pgrst, 'reload schema';

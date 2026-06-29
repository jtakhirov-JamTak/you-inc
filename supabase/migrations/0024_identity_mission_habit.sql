-- 0024_identity_mission_habit — link the Mission habit to the charter.
--
-- The Mission habit (a per-day asset, cadence 'mission') is authored from the
-- Mission tab, not the Systems roster. This column links the user's identity
-- charter to that habit so the Mission screen can show / replace it. ON DELETE SET
-- NULL: archiving/replacing the habit nulls the link rather than cascading. Held on
-- the existing identity_profile singleton — the 0006 SELECT/INSERT/UPDATE-own
-- policies already cover this column, so no new RLS.
--
-- Additive + nullable, so this is safe to apply BEFORE the clean-reset.
alter table public.identity_profile
  add column if not exists mission_habit_id uuid
  references public.habits(id) on delete set null;

notify pgrst, 'reload schema';

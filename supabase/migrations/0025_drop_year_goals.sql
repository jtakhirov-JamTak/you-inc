-- 0025_drop_year_goals — remove the 1-year goal feature.
--
-- The yearly goal is replaced by the guided 10–14 day sprint flow (the guided
-- visualization moves onto sprint creation). The year_goals table (0005 + the 0020
-- narrative columns + weekly_habit_id FK) is no longer read or written by any code
-- path. The clean-reset already TRUNCATEs it; this drops the table outright.
--
-- year_goals.weekly_habit_id referenced public.habits(id) ON DELETE SET NULL — a
-- one-directional dependency, so dropping year_goals leaves habits untouched. No
-- other table references year_goals.
drop table if exists public.year_goals;

notify pgrst, 'reload schema';

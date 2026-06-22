-- 0017_graduated_habits_unique.sql
-- Make graduation idempotent: at most one shelf row per source habit. The app's
-- status gate (status='active') blocks a *sequential* re-graduate, but not two
-- concurrent requests or a retried POST — both read 'active' before either writes,
-- inserting duplicate shelf rows. This partial unique index makes the second
-- insert fail with 23505, which the endpoint treats as success (the row is already
-- there). NULL source_habit_id (source hard-deleted, FK set null) is exempt.

create unique index if not exists graduated_habits_user_source_unique
  on public.graduated_habits (user_id, source_habit_id)
  where source_habit_id is not null;

notify pgrst, 'reload schema';

-- 0026_index_mission_habit_id — covering index for the 0024 FK.
--
-- 0024 added identity_profile.mission_habit_id (FK → habits) but no index. The FK
-- is rarely scanned (identity_profile is a per-user singleton), so this is a minor
-- advisor-lint fix, not a hot path — but it silences the unindexed-FK advisor and
-- keeps the ON DELETE SET NULL path off a sequential scan when a habit is deleted.
create index if not exists identity_profile_mission_habit_id_idx
  on public.identity_profile (mission_habit_id);

notify pgrst, 'reload schema';

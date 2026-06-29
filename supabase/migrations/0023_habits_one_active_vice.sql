-- 0023_habits_one_active_vice — DB backstop for the single-vice cap.
--
-- The new roster holds exactly ONE vice (down from two). The app layer enforces
-- this (validateRosterAddition, MAX_LIABILITIES = 1), but — mirroring the asset
-- backstop in 0021 — a partial unique index hardens it against a raced/double
-- submit. The second concurrent insert fails with 23505, which api/habits/route.ts
-- maps to a 409.
--
-- Scoped to ACTIVE LIABILITIES (vices). Assets are covered by 0021's per-cadence
-- index; replaced/retired rows are exempt so a freed slot can be refilled.
--
-- ORDERING: run AFTER the clean-reset, so no user holds 2 active vices when the
-- unique index is built (creation would otherwise fail).

create unique index if not exists habits_one_active_vice
  on public.habits (user_id)
  where status = 'active' and kind = 'liability';

notify pgrst, 'reload schema';

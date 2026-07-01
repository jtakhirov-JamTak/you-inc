-- 0033_habits_deactivated_at — freeze-safe roster membership (as-of-week-END).
--
-- WHY: the price engine froze each week's roster snapshot LAZILY (at the first settle
-- past grace) reading the CURRENT habits roster (weeks.ts filtered live status='active'
-- and read live area). So archiving/retiring/graduating a habit in the gap between a
-- week ending and its lazy settle dropped or mis-filed it in that week — a correctness
-- bug AND a way to dodge a penalty (fail a vice, archive it before the week locks).
--
-- FIX (scoped): record WHEN a habit left 'active' so settlement can include it in a
-- week if it was active AS OF that week's END. A deactivation strictly after week-end
-- still counts the habit fully for that week (closes the dodge); on/before week-end
-- excludes it (a legit mid-week retire). Area re-tag as-of-week is a deferred "full"
-- version (display-only, doesn't affect the operating value).
--
-- status only ever goes active→terminal (never back), so at most one of the two is set.

alter table public.habits
  add column if not exists archived_at   timestamptz,
  add column if not exists graduated_at  timestamptz;

-- Backfill existing terminal rows so the as-of predicate doesn't read a null timestamp
-- as "never deactivated" (which would re-include a retired habit in every week).
-- updated_at is stamped at each status flip, so it's an accurate proxy for the exit time.
update public.habits set graduated_at = updated_at
  where status = 'graduated' and graduated_at is null;
update public.habits set archived_at = updated_at
  where status in ('retired', 'replaced') and archived_at is null;

notify pgrst, 'reload schema';

-- 0022_habits_new_cadence_model — the redesigned 4-position roster.
--
-- The roster moves from { morning, daily, weekly assets + 2 vices } to
-- { morning, evening, mission assets + 1 vice }. All three positive assets now
-- score per-day (the weekly cadence and its per-occurrence/recurrence scoring are
-- gone). This swaps the cadence CHECK to the new value set.
--
-- ORDERING: this MUST run AFTER the one-time clean-reset (TRUNCATE of public.habits
-- and the domain tables) — otherwise any surviving row with cadence 'daily'/'weekly'
-- would violate the new constraint and the ALTER would be rejected.
--
-- The companion constraint habits_cadence_matches_kind (asset ⇒ cadence,
-- liability ⇒ no cadence) is unchanged. recurrence_rule stays as a dormant,
-- always-null column (dropping it is irreversible churn; nothing reads it now).

alter table public.habits drop constraint if exists habits_cadence_check;
alter table public.habits
  add constraint habits_cadence_check
  check (cadence in ('morning', 'evening', 'mission'));

notify pgrst, 'reload schema';

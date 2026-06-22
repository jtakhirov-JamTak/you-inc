-- 0018_identity_mission — add the Mission to the charter. A short (1–3 word)
-- user-authored statement held on the existing per-user identity_profile
-- singleton. Editable narrative data (not a log); no new RLS needed — the
-- identity_profile SELECT/INSERT/UPDATE-own policies (0006) cover this column.
alter table public.identity_profile add column if not exists mission text;

notify pgrst, 'reload schema';

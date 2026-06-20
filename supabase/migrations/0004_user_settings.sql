-- 0004_user_settings — per-user timezone + week-start preference.
--
-- The price engine settles habits weekly, and a "week" is defined in the user's
-- own timezone with a configurable start day (DST-correct boundaries are computed
-- later in SQL via `AT TIME ZONE`). Every user needs exactly one settings row, so
-- the signup trigger is extended to create it alongside the profile row.

create table if not exists public.user_settings (
  -- One settings row per user; PK is the auth user id directly.
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- IANA timezone name (e.g. 'America/New_York'). Defaults to UTC at signup and
  -- is set to the user's real zone during onboarding.
  timezone text not null default 'UTC',
  -- Day the settlement week begins: 0=Sunday .. 6=Saturday. Default Monday (1),
  -- so the Board's "Sunday review" lands on the last day of the week.
  week_start smallint not null default 1 check (week_start between 0 and 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

-- A user reads and updates only their own settings. No INSERT policy: the row is
-- created by the SECURITY DEFINER signup trigger, not by the client. No DELETE
-- policy: settings are removed only via the auth.users cascade on account delete.
drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own
  on public.user_settings for select
  using (auth.uid() = user_id);

drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own
  on public.user_settings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Extend the signup trigger to also seed the settings row. SECURITY DEFINER +
-- pinned empty search_path are preserved from 0002; CREATE OR REPLACE keeps the
-- 0003 EXECUTE revoke intact, but we re-issue it at the end for safety.
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.user_profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- Backfill settings for any user that predates this migration (e.g. the founder's
-- own test account).
insert into public.user_settings (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- Re-assert the lockdown from 0003: the trigger fn must never be callable as an
-- RPC by public/anon/authenticated.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

notify pgrst, 'reload schema';

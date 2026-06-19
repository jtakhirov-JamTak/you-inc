-- 0001_init_core — foundation schema for You, Inc.
-- Only the core user profile. Domain tables (identity, goals, sprints, habits,
-- regulation, weekly board meeting) and the score/price engine land in later
-- migrations once their shapes are designed.
--
-- Convention for every future user-scoped table: a `user_id uuid not null
-- references auth.users(id) on delete cascade`, RLS enabled, and per-row
-- policies of the form `using (auth.uid() = user_id)`. Never `using (true)`.

create table if not exists public.user_profiles (
  -- PK is the auth user id directly (one profile per user). Cascades on user
  -- deletion so account-delete erases this row with no orphan.
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text,
  -- Onboarding/access anchor. Kept user-unwritable (no UPDATE of this column,
  -- no DELETE policy) so it can't be reset by a profile retake.
  created_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

-- A user can read and create their own profile row, and update their own
-- mutable fields. No DELETE policy: profile rows are removed only via the
-- auth.users cascade on full account deletion (service-role path).
drop policy if exists user_profiles_select_own on public.user_profiles;
create policy user_profiles_select_own
  on public.user_profiles for select
  using (auth.uid() = id);

drop policy if exists user_profiles_insert_own on public.user_profiles;
create policy user_profiles_insert_own
  on public.user_profiles for insert
  with check (auth.uid() = id);

drop policy if exists user_profiles_update_own on public.user_profiles;
create policy user_profiles_update_own
  on public.user_profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Reload PostgREST's schema cache so the new table is queryable immediately.
notify pgrst, 'reload schema';

-- 0006_identity — the charter. ALL content is user-authored at setup and editable;
-- nothing here is system-generated. Four pieces per the spec: profile, values (3),
-- modes (3 fixed contexts), and affirmations.

-- ── Profile: a singleton per user. The spec lists "profile" under Identity without
--    enumerating fields; we hold an optional free-text summary/charter line. Drop
--    or extend once the spec defines it.
create table if not exists public.identity_profile (
  user_id uuid primary key references auth.users (id) on delete cascade,
  summary text,
  updated_at timestamptz not null default now()
);

-- ── Values: exactly 3, each { title, meaning }. position 1..3 orders them.
create table if not exists public.identity_values (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  position smallint not null check (position between 1 and 3),
  title text not null,
  meaning text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, position)
);

-- ── Modes: 3 fixed contexts. Each has a user-populated { mode_name, description }
--    (e.g. baseline -> "The Listener" + one line).
create table if not exists public.identity_modes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  mode_key text not null check (mode_key in ('baseline', 'close_people', 'under_pressure')),
  mode_name text not null,
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One row per context per user.
  unique (user_id, mode_key)
);

-- ── Affirmations: user-entered, each pairs an { affirmation, visualization }.
create table if not exists public.identity_affirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  position smallint not null,
  affirmation text not null,
  visualization text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, position)
);

create index if not exists identity_values_user_idx on public.identity_values (user_id);
create index if not exists identity_modes_user_idx on public.identity_modes (user_id);
create index if not exists identity_affirmations_user_idx on public.identity_affirmations (user_id);

-- ── RLS: owner full CRUD on each table (all content is user-authored).
alter table public.identity_profile enable row level security;
alter table public.identity_values enable row level security;
alter table public.identity_modes enable row level security;
alter table public.identity_affirmations enable row level security;

-- identity_profile: select + insert + update own; no delete (cascade only).
drop policy if exists identity_profile_select_own on public.identity_profile;
create policy identity_profile_select_own on public.identity_profile
  for select using (auth.uid() = user_id);
drop policy if exists identity_profile_insert_own on public.identity_profile;
create policy identity_profile_insert_own on public.identity_profile
  for insert with check (auth.uid() = user_id);
drop policy if exists identity_profile_update_own on public.identity_profile;
create policy identity_profile_update_own on public.identity_profile
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- identity_values / identity_modes / identity_affirmations: full owner CRUD.
drop policy if exists identity_values_select_own on public.identity_values;
create policy identity_values_select_own on public.identity_values
  for select using (auth.uid() = user_id);
drop policy if exists identity_values_insert_own on public.identity_values;
create policy identity_values_insert_own on public.identity_values
  for insert with check (auth.uid() = user_id);
drop policy if exists identity_values_update_own on public.identity_values;
create policy identity_values_update_own on public.identity_values
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists identity_values_delete_own on public.identity_values;
create policy identity_values_delete_own on public.identity_values
  for delete using (auth.uid() = user_id);

drop policy if exists identity_modes_select_own on public.identity_modes;
create policy identity_modes_select_own on public.identity_modes
  for select using (auth.uid() = user_id);
drop policy if exists identity_modes_insert_own on public.identity_modes;
create policy identity_modes_insert_own on public.identity_modes
  for insert with check (auth.uid() = user_id);
drop policy if exists identity_modes_update_own on public.identity_modes;
create policy identity_modes_update_own on public.identity_modes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists identity_modes_delete_own on public.identity_modes;
create policy identity_modes_delete_own on public.identity_modes
  for delete using (auth.uid() = user_id);

drop policy if exists identity_affirmations_select_own on public.identity_affirmations;
create policy identity_affirmations_select_own on public.identity_affirmations
  for select using (auth.uid() = user_id);
drop policy if exists identity_affirmations_insert_own on public.identity_affirmations;
create policy identity_affirmations_insert_own on public.identity_affirmations
  for insert with check (auth.uid() = user_id);
drop policy if exists identity_affirmations_update_own on public.identity_affirmations;
create policy identity_affirmations_update_own on public.identity_affirmations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists identity_affirmations_delete_own on public.identity_affirmations;
create policy identity_affirmations_delete_own on public.identity_affirmations
  for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';

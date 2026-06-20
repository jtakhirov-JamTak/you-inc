-- 0005_year_goals — one one-year goal per life area.
--
-- Spec: "One-year goals — one per area: Health / Wealth / Relationships." Sprints
-- ladder up to these. The spec does not enumerate goal fields; this is the minimal
-- shape (area + title + narrative + optional target date), to be extended if the
-- spec grows.

create table if not exists public.year_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Exactly one of the three life areas.
  area text not null check (area in ('health', 'wealth', 'relationships')),
  title text not null,
  description text,
  target_date date,
  -- 'active' goals are the current one-per-area; superseded goals go 'archived'
  -- rather than being deleted, so history survives.
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one ACTIVE goal per (user, area). Archived goals are unconstrained.
create unique index if not exists year_goals_one_active_per_area
  on public.year_goals (user_id, area)
  where status = 'active';

create index if not exists year_goals_user_idx
  on public.year_goals (user_id);

alter table public.year_goals enable row level security;

drop policy if exists year_goals_select_own on public.year_goals;
create policy year_goals_select_own
  on public.year_goals for select
  using (auth.uid() = user_id);

drop policy if exists year_goals_insert_own on public.year_goals;
create policy year_goals_insert_own
  on public.year_goals for insert
  with check (auth.uid() = user_id);

drop policy if exists year_goals_update_own on public.year_goals;
create policy year_goals_update_own
  on public.year_goals for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists year_goals_delete_own on public.year_goals;
create policy year_goals_delete_own
  on public.year_goals for delete
  using (auth.uid() = user_id);

notify pgrst, 'reload schema';

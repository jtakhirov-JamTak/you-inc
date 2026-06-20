-- 0008_sprints — time-boxed investments toward a year goal.
--
-- A sprint is a 10–14 day investment (not a habit). One active at a time, plus a
-- sequential queue. At finalize the payoff %s convert to a fixed DOLLAR grid using
-- the balance at set-time, frozen for the sprint's duration. Operating value is
-- realized-only: the sprint books into the ledger only at close (see 0010).

create table if not exists public.sprints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  size text not null check (size in ('small', 'medium', 'big')),
  area text not null check (area in ('health', 'wealth', 'relationships')),
  -- Falsifiable thesis ("if I do X, the goal becomes real"). Never the scored
  -- outcome — only tasks are scored.
  thesis text not null,
  term_days smallint not null check (term_days between 10 and 14),

  -- draft (being authored) → queued (finalized, waiting) → active (running) →
  -- closed (realized) | abandoned.
  status text not null default 'draft'
    check (status in ('draft', 'queued', 'active', 'closed', 'abandoned')),
  -- Ordering within the queue (NULL when not queued).
  queue_position int,

  -- Set-time lock (frozen at finalize): the balance the grid was priced against,
  -- and the resulting fixed dollar payoff grid. scoring_version stamps the config
  -- used to build the grid.
  set_time_balance_cents bigint,
  locked_grid jsonb,
  scoring_version int,

  -- Realized outcome (set at close): which payoff band, its %, the booked dollars,
  -- and whether the upside-only goal bonus applied.
  goal_achieved boolean,
  realized_band text,
  realized_pct numeric,
  realized_amount_cents bigint,

  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one ACTIVE sprint per user (sequential, never parallel).
create unique index if not exists sprints_one_active_per_user
  on public.sprints (user_id)
  where status = 'active';

create index if not exists sprints_user_status_idx on public.sprints (user_id, status);

-- ── sprint_tasks: the controllable checklist. Completion % = done / total drives
--    the payoff band.
create table if not exists public.sprint_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  sprint_id uuid not null references public.sprints (id) on delete cascade,
  title text not null,
  done boolean not null default false,
  done_at timestamptz,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists sprint_tasks_sprint_idx on public.sprint_tasks (sprint_id);
create index if not exists sprint_tasks_user_idx on public.sprint_tasks (user_id);

-- ── RLS: full owner CRUD on both.
alter table public.sprints enable row level security;
alter table public.sprint_tasks enable row level security;

drop policy if exists sprints_select_own on public.sprints;
create policy sprints_select_own on public.sprints
  for select using (auth.uid() = user_id);
drop policy if exists sprints_insert_own on public.sprints;
create policy sprints_insert_own on public.sprints
  for insert with check (auth.uid() = user_id);
drop policy if exists sprints_update_own on public.sprints;
create policy sprints_update_own on public.sprints
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists sprints_delete_own on public.sprints;
create policy sprints_delete_own on public.sprints
  for delete using (auth.uid() = user_id);

drop policy if exists sprint_tasks_select_own on public.sprint_tasks;
create policy sprint_tasks_select_own on public.sprint_tasks
  for select using (auth.uid() = user_id);
drop policy if exists sprint_tasks_insert_own on public.sprint_tasks;
create policy sprint_tasks_insert_own on public.sprint_tasks
  for insert with check (auth.uid() = user_id);
drop policy if exists sprint_tasks_update_own on public.sprint_tasks;
create policy sprint_tasks_update_own on public.sprint_tasks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists sprint_tasks_delete_own on public.sprint_tasks;
create policy sprint_tasks_delete_own on public.sprint_tasks
  for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';

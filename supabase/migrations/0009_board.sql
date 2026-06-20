-- 0009_board — the weekly statement ("Sunday review — what moved the price").
--
-- One board meeting per settlement week, holding the closing value, the week delta,
-- a narrative note, the per-area contribution split, and a set of checkable
-- resolutions carried into the following week.

create table if not exists public.board_meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Per-user settlement week index (weeks since signup, in the user's timezone).
  week_index int not null,

  closing_value_cents bigint not null,
  week_delta_cents bigint not null,
  note text,

  -- { health, wealth, relationships, operations } contribution in cents. Untagged
  -- habits roll up under "operations"; tagged habits + sprints split by area.
  area_contributions jsonb not null default '{}'::jsonb,

  settled_at timestamptz,
  created_at timestamptz not null default now(),

  -- One meeting per week per user.
  unique (user_id, week_index)
);

create index if not exists board_meetings_user_week_idx
  on public.board_meetings (user_id, week_index desc);

-- ── board_resolutions: checkable commitments authored at one meeting for the next
--    week.
create table if not exists public.board_resolutions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  meeting_id uuid not null references public.board_meetings (id) on delete cascade,
  -- The week this resolution is meant to be acted on.
  for_week_index int not null,
  text text not null,
  checked boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists board_resolutions_meeting_idx
  on public.board_resolutions (meeting_id);
create index if not exists board_resolutions_user_idx
  on public.board_resolutions (user_id);

-- ── RLS.
alter table public.board_meetings enable row level security;
alter table public.board_resolutions enable row level security;

-- board_meetings: owner select/update (e.g. editing the note). Rows are created by
-- server-side settlement; no client INSERT/DELETE policy.
drop policy if exists board_meetings_select_own on public.board_meetings;
create policy board_meetings_select_own on public.board_meetings
  for select using (auth.uid() = user_id);
drop policy if exists board_meetings_update_own on public.board_meetings;
create policy board_meetings_update_own on public.board_meetings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- board_resolutions: owner full CRUD (user authors and checks them off).
drop policy if exists board_resolutions_select_own on public.board_resolutions;
create policy board_resolutions_select_own on public.board_resolutions
  for select using (auth.uid() = user_id);
drop policy if exists board_resolutions_insert_own on public.board_resolutions;
create policy board_resolutions_insert_own on public.board_resolutions
  for insert with check (auth.uid() = user_id);
drop policy if exists board_resolutions_update_own on public.board_resolutions;
create policy board_resolutions_update_own on public.board_resolutions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists board_resolutions_delete_own on public.board_resolutions;
create policy board_resolutions_delete_own on public.board_resolutions
  for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';

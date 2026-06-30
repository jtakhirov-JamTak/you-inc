-- 0027_settled_weeks — the FROZEN per-week FACT (Layer 1). A write-once record that
-- week N has elapsed past its grace day, carrying the exact bucketed position
-- inputs at that moment.
--
-- WHY: the price_ledger stops being a permanent tally and becomes a pure PROJECTION
-- of these facts under the current SCORING_VERSION constants. A tuning bump
-- re-derives the ledger from these snapshots (a REPLAY) instead of resetting value
-- to baseline. For that replay to be deterministic, EVERY mutable input to the week
-- math must be frozen here — not just the logs:
--   • roster membership (a habit retired later must still appear in the weeks it was
--     active for — weeks.ts otherwise filters on CURRENT status='active'),
--   • each habit's area tag (re-tagging Health→Wealth must not retro-move a region),
--   • the timezone / week_start used to bucket days (both mutable in user_settings),
--   • the per-day done/miss/clean/relapse counts themselves.
-- The snapshot is the bucketed PositionWeekInput[] — the exact input to
-- foldSettlements — so replay re-runs ONLY the constants over frozen inputs.
--
-- habit_logs remain the deeper archive: a structural change to the BUCKETING rule
-- (not a constant tune) rebuilds these snapshots from the logs as a deliberate
-- migration. Routine tuning never touches them.
--
-- This row is also the FREEZE ANCHOR (see 0029): it is written only when a week
-- crosses its grace boundary, so its existence is what locks that week's logs.

create table if not exists public.settled_weeks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Per-user settlement week index (weeks since signup, in the user's timezone).
  week_index int not null,
  -- The week's local-date range [week_start, week_end] (Mon..Sun in the user's tz).
  -- week_end carries the freeze boundary — 0029's trigger reads this range directly.
  week_start date not null,
  week_end date not null,
  days_in_week int not null,

  -- The frozen PositionWeekInput[] snapshot (the inputs to foldSettlements). Immutable.
  positions jsonb not null default '[]'::jsonb,

  -- When settlement actually ran (the first load at/after the grace boundary). This
  -- is the immutable server insert time, never a client clock.
  settled_at timestamptz not null default now(),

  -- One frozen fact per week per user; the runner inserts ignore-on-conflict.
  unique (user_id, week_index)
);

create index if not exists settled_weeks_user_week_idx
  on public.settled_weeks (user_id, week_index);

-- ── RLS. Append-only Layer-1 fact (Playbook §9): owner SELECT + INSERT only. With
--    NO update/delete policies, RLS denies them, so a settled week's snapshot is
--    immutable — corrections are never an in-place edit. Account-delete still erases
--    via the auth.users cascade. The price engine writes these under the service
--    role (which bypasses RLS); these policies govern the authenticated client.
alter table public.settled_weeks enable row level security;

drop policy if exists settled_weeks_select_own on public.settled_weeks;
create policy settled_weeks_select_own on public.settled_weeks
  for select using (auth.uid() = user_id);

drop policy if exists settled_weeks_insert_own on public.settled_weeks;
create policy settled_weeks_insert_own on public.settled_weeks
  for insert with check (auth.uid() = user_id);

notify pgrst, 'reload schema';

-- 0016_position_daily_snapshots.sql
-- Per-position daily contribution snapshot — powers Home's inline per-position
-- sparklines (design handoff §1).
--
-- DATA CLASSIFICATION: derived DISPLAY cache, NOT a raw action log. It records no
-- user action — it materializes a number the engine already derives from
-- habit_logs (a position's contribution to the current open week), stamped per
-- local day. So, unlike the append-only log tables (§9 raw+derived), it is
-- MUTABLE by natural key: recomputing overwrites today's row; past days freeze
-- because only "today" is ever written. It can be dropped and rebuilt from logs
-- at any time without losing source-of-truth data. Writes happen under the
-- service role (the runner); reads may go through the user client.

create table if not exists public.position_daily_snapshots (
  user_id uuid not null references auth.users (id) on delete cascade,
  habit_id uuid not null references public.habits (id) on delete cascade,
  local_date date not null,
  -- the position's PER-DAY marginal contribution on this local day, in cents
  -- (week-to-date minus end-of-yesterday) — the sparkline's per-day primitive.
  contrib_cents integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, habit_id, local_date)
);

create index if not exists position_daily_snapshots_lookup_idx
  on public.position_daily_snapshots (user_id, habit_id, local_date desc);

alter table public.position_daily_snapshots enable row level security;

-- Owner select/insert/update. UPDATE is allowed (unlike the append-only log
-- tables) because this is a recomputable cache keyed by (user, habit, day) — an
-- upsert overwrites today's value as the day progresses. No DELETE policy: the
-- auth.users / habits cascades handle removal.
drop policy if exists position_daily_snapshots_select_own on public.position_daily_snapshots;
create policy position_daily_snapshots_select_own on public.position_daily_snapshots
  for select using (auth.uid() = user_id);

drop policy if exists position_daily_snapshots_insert_own on public.position_daily_snapshots;
create policy position_daily_snapshots_insert_own on public.position_daily_snapshots
  for insert with check (auth.uid() = user_id);

drop policy if exists position_daily_snapshots_update_own on public.position_daily_snapshots;
create policy position_daily_snapshots_update_own on public.position_daily_snapshots
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';

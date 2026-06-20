-- 0007_habits — the balance sheet: assets, liabilities, their raw daily logs, and
-- the graduated holdings shelf.
--
-- Roster (fixed shape): exactly 3 assets (1 morning · 1 daily · 1 weekly) + 2
-- liabilities (vices). Scoring reconciliation: morning + daily = the "daily habit"
-- rows; the weekly slot = the "weekly habit" row (custom recurrence → ÷days).
--
-- RAW + DERIVED: habit_logs is the raw per-day source of truth. Weekly settlement
-- and ledger events are derived from it (see 0010). The streak/clean fields on
-- `habits` are a DERIVED CACHE (rebuildable from habit_logs), kept for cheap reads.

-- ── habits: the position definitions (config), not the daily events.
create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- asset = something you build (long); liability = a vice you pay down (short).
  kind text not null check (kind in ('asset', 'liability')),

  -- Cadence tag for assets: morning | daily | weekly. NULL for liabilities.
  -- (morning + daily are both daily-frequency; weekly uses recurrence_rule.)
  cadence text check (cadence in ('morning', 'daily', 'weekly')),

  -- Optional life-area attribution (Board can split contributions by area).
  area text check (area in ('health', 'wealth', 'relationships')),

  title text not null,
  description text,

  -- Commitment/review term for assets (7|14|30|60 days) — a review cadence, not a
  -- maturity claim. NULL for liabilities (open-ended). term_started_on anchors
  -- "day x/term" progress.
  term_days smallint check (term_days in (7, 14, 30, 60)),
  term_started_on date,

  -- Custom recurrence for the weekly slot (e.g. every N days, or chosen weekdays).
  -- Drives the per-week scheduled-occurrence count for the ÷days divisor. NULL for
  -- morning/daily/liability.
  recurrence_rule jsonb,

  -- Lifecycle: active (scoring) | graduated (moved to shelf, stops scoring) |
  -- retired (liability hit its clean-streak target) | replaced (swapped at review).
  status text not null default 'active'
    check (status in ('active', 'graduated', 'retired', 'replaced')),

  -- DERIVED CACHE (authoritative source = habit_logs):
  --   current_streak_days — consecutive qualifying days for this position.
  --   clean_since — for liabilities, the date the current clean run began.
  current_streak_days int not null default 0,
  clean_since date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- An asset must carry a cadence; a liability must not.
  constraint habits_cadence_matches_kind check (
    (kind = 'asset' and cadence is not null) or
    (kind = 'liability' and cadence is null)
  )
);

create index if not exists habits_user_status_idx on public.habits (user_id, status);

-- ── habit_logs: raw per-day completions (append-only log convention).
--    Sparse + affirmative: an asset row means "done on local_date"; a liability
--    row means "relapse on local_date". Absence = not-done (asset) / clean
--    (liability). Settlement reads counts from these rows.
create table if not exists public.habit_logs (
  log_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  habit_id uuid not null references public.habits (id) on delete cascade,

  -- The user-local calendar date this completion/relapse counts toward (used for
  -- weekly bucketing). occurred_at is the absolute instant; occurred_tz is the
  -- zone captured at write time (so time-of-day analytics survive travel/DST).
  local_date date not null,
  occurred_at timestamptz not null default now(),
  occurred_tz text,
  recorded_at timestamptz not null default now(),

  -- 'done' for an asset completion; 'relapse' for a liability slip.
  status text not null check (status in ('done', 'relapse')),

  -- Per-submission idempotency key (client mints one per tap, resends on retry).
  source_session_id uuid,
  note text,
  metadata jsonb not null default '{}'::jsonb,

  -- One affirmative log per habit per local day (a second tap is a no-op / undo).
  unique (user_id, habit_id, local_date)
);

create index if not exists habit_logs_user_habit_date_idx
  on public.habit_logs (user_id, habit_id, local_date desc);
create index if not exists habit_logs_user_date_idx
  on public.habit_logs (user_id, local_date desc);

-- ── graduated_habits: the holdings shelf. Written when a human graduates a habit
--    at term review (a deliberate judgment, never automatic). Snapshot row so the
--    shelf survives edits/deletes to the source habit.
create table if not exists public.graduated_habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_habit_id uuid references public.habits (id) on delete set null,
  title text not null,
  area text check (area in ('health', 'wealth', 'relationships')),
  graduated_on date not null default current_date,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists graduated_habits_user_idx on public.graduated_habits (user_id);

-- ── RLS.
alter table public.habits enable row level security;
alter table public.habit_logs enable row level security;
alter table public.graduated_habits enable row level security;

-- habits: full owner CRUD (definitions are user-managed).
drop policy if exists habits_select_own on public.habits;
create policy habits_select_own on public.habits
  for select using (auth.uid() = user_id);
drop policy if exists habits_insert_own on public.habits;
create policy habits_insert_own on public.habits
  for insert with check (auth.uid() = user_id);
drop policy if exists habits_update_own on public.habits;
create policy habits_update_own on public.habits
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists habits_delete_own on public.habits;
create policy habits_delete_own on public.habits
  for delete using (auth.uid() = user_id);

-- habit_logs: owner select/insert/delete. DELETE is allowed as a same-day undo of
-- a completion; there is no UPDATE (a log is a fact, toggled by insert/delete).
-- NOTE: edits to an already-settled week do not retro-change the ledger — the
-- week's settlement key is already booked (see 0010).
drop policy if exists habit_logs_select_own on public.habit_logs;
create policy habit_logs_select_own on public.habit_logs
  for select using (auth.uid() = user_id);
drop policy if exists habit_logs_insert_own on public.habit_logs;
create policy habit_logs_insert_own on public.habit_logs
  for insert with check (auth.uid() = user_id);
drop policy if exists habit_logs_delete_own on public.habit_logs;
create policy habit_logs_delete_own on public.habit_logs
  for delete using (auth.uid() = user_id);

-- graduated_habits: owner select/insert/delete (no update — it's a snapshot).
drop policy if exists graduated_habits_select_own on public.graduated_habits;
create policy graduated_habits_select_own on public.graduated_habits
  for select using (auth.uid() = user_id);
drop policy if exists graduated_habits_insert_own on public.graduated_habits;
create policy graduated_habits_insert_own on public.graduated_habits
  for insert with check (auth.uid() = user_id);
drop policy if exists graduated_habits_delete_own on public.graduated_habits;
create policy graduated_habits_delete_own on public.graduated_habits
  for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';

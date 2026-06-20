-- 0010_price_ledger — the append-only event store the operating value folds over.
--
--   operating_value_cents = BASELINE_CENTS (=$200,000) + sum(amount_cents)
--
-- This is the authoritative, REALIZED price. The displayed Home value adds an
-- in-memory provisional mark for the current unsettled week (computed on read,
-- never written here). Sprints book only at close.
--
-- INTEGRITY (locked by the spec):
--   • Append-only: no UPDATE/DELETE, ever. Corrections are new events.
--   • Idempotent: every settlement carries a DETERMINISTIC settlement_key under a
--     unique constraint, so reruns/replays cannot double-book.
--   • No client writes: RLS grants SELECT only. Writes happen exclusively through
--     trusted server-only code using the service-role client (which bypasses RLS).
--     authenticated/anon hold no INSERT/UPDATE/DELETE policy → all writes denied.

create table if not exists public.price_ledger (
  -- Monotonic row handle; natural insert order for replay.
  ledger_id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,

  event_type text not null check (event_type in (
    'habit_week_settled',  -- aggregate net habit/vice contribution for a week
    'streak_bonus',        -- per-category consecutive-full-week bonus
    'recovery_bonus',      -- per-category bonus after a missed week
    'collapse_penalty',    -- per-category consecutive-zero-week penalty
    'sprint_realized'      -- a sprint's realized return, booked at close
  )),

  -- Deterministic idempotency key, unique per user. Formats:
  --   habit_week:{week_index} · streak:{category}:{week_index} ·
  --   recovery:{category}:{week_index} · collapse:{category}:{week_index} ·
  --   sprint_realized:{sprint_id}
  settlement_key text not null,

  -- Signed dollar delta in cents — the only field the fold needs.
  amount_cents bigint not null,
  -- Audit trail: the % applied and the denominator it was applied to (fixed $200k
  -- baseline for habits/streak/collapse; set-time balance for sprints).
  pct numeric,
  basis_cents bigint,
  scoring_version int not null,

  -- Logical time the event belongs to (week-end or sprint-close), distinct from
  -- created_at (when the row was written).
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- Full breakdown snapshot (per-habit / per-area detail, completion %, etc.).
  metadata jsonb not null default '{}'::jsonb,

  -- The idempotency backbone: one event per (user, settlement_key).
  unique (user_id, settlement_key)
);

-- Fold + per-user history reads.
create index if not exists price_ledger_user_idx on public.price_ledger (user_id);
create index if not exists price_ledger_user_occurred_idx
  on public.price_ledger (user_id, occurred_at desc);

alter table public.price_ledger enable row level security;

-- SELECT own only. Deliberately NO insert/update/delete policy: RLS denies those
-- by default, so no client (authenticated or anon) can write the ledger. Trusted
-- server code writes via the service-role client.
drop policy if exists price_ledger_select_own on public.price_ledger;
create policy price_ledger_select_own on public.price_ledger
  for select using (auth.uid() = user_id);

notify pgrst, 'reload schema';

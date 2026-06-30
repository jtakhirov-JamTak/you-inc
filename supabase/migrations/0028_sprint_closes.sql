-- 0028_sprint_closes — the FROZEN sprint outcome FACT (Layer 1).
--
-- A sprint payoff is a REALIZED event, like a closed trade — NOT a re-tunable
-- valuation. This is the deliberate OPPOSITE of a habit week (settled_weeks, which
-- freezes INPUTS and re-tunes the dollar output): tuning a constant must NEVER
-- retro-change a 6-month-old sprint's payoff. So we freeze the realized dollar
-- OUTCOME here; the replay re-emits `realized_amount_cents` verbatim into the
-- price_ledger rather than recomputing it against a recomputed balance.
--
-- We also keep the denominator (`frozen_basis_cents`, the balance locked at create)
-- and the inputs that produced the outcome, so the fact is self-describing and the
-- re-emitted ledger row's metadata is reconstructable byte-for-byte.

create table if not exists public.sprint_closes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  sprint_id uuid not null references public.sprints (id) on delete cascade,

  -- The denominator: balance frozen at the sprint's CREATE (not the $200k baseline).
  frozen_basis_cents bigint not null,

  tasks_done int not null,
  tasks_total int not null,
  goal_achieved boolean not null,

  -- The sprint's frozen life-area (region attribution); null → 'operations'.
  area text,

  -- The realized RETURN — frozen % and dollars. Replay re-emits these verbatim.
  realized_pct numeric not null,
  realized_amount_cents bigint not null,

  -- The close date in the user's timezone AT CLOSE (frozen — tz is mutable, so the
  -- replay must not re-derive this from a now-changed zone). Drives week attribution.
  closed_local_date date not null,

  -- A verbatim snapshot of the sprint_realized ledger row's metadata at close, so
  -- the re-emitted projection row is byte-identical to the original.
  metadata jsonb not null default '{}'::jsonb,

  recorded_at timestamptz not null default now(),

  -- One close fact per sprint per user.
  unique (user_id, sprint_id)
);

create index if not exists sprint_closes_user_idx
  on public.sprint_closes (user_id);

-- ── RLS. Append-only Layer-1 fact: owner SELECT + INSERT only (no update/delete →
--    RLS denies them). Written by the sprint runner under the service role.
alter table public.sprint_closes enable row level security;

drop policy if exists sprint_closes_select_own on public.sprint_closes;
create policy sprint_closes_select_own on public.sprint_closes
  for select using (auth.uid() = user_id);

drop policy if exists sprint_closes_insert_own on public.sprint_closes;
create policy sprint_closes_insert_own on public.sprint_closes
  for insert with check (auth.uid() = user_id);

notify pgrst, 'reload schema';

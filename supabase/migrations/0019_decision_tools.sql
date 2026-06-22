-- 0019_decision_tools — Decision Making (the Regulation area) on the Systems
-- screen. A singleton per user holding editable notes/checklists: a meditation
-- routine, a decision-making protocol, and the four Eisenhower quadrants.
-- Editable narrative data (not an append-only log) — no scoring ties.
create table if not exists public.decision_tools (
  user_id uuid primary key references auth.users (id) on delete cascade,
  meditation text,
  protocol text,
  eis_do text,        -- urgent + important   → Do
  eis_decide text,    -- important, not urgent → Decide / schedule
  eis_delegate text,  -- urgent, not important → Delegate
  eis_delete text,    -- neither               → Delete / drop
  updated_at timestamptz not null default now()
);

alter table public.decision_tools enable row level security;

create policy "decision_tools_select_own" on public.decision_tools
  for select using (auth.uid() = user_id);
create policy "decision_tools_insert_own" on public.decision_tools
  for insert with check (auth.uid() = user_id);
create policy "decision_tools_update_own" on public.decision_tools
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';

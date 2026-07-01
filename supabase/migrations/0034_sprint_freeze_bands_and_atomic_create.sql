-- 0034_sprint_freeze_bands_and_atomic_create — freeze the payoff bands at create (C)
-- and make sprint creation atomic (D).
--
-- C — WHY: closeSprint recomputed the payout against the LIVE SPRINT_PAYOFF_BANDS
-- (config.ts) and never read the row's scoring_version, so tuning the band table
-- mid-sprint changed an already-open sprint's payout. We now FREEZE the resolved
-- % bands + goal bonus onto the row at create and read them at close. This
-- deliberately REVERSES 0014's locked_grid drop — but unlike locked_grid this copy
-- is READ at close, so the "written-and-ignored can only diverge" objection no
-- longer applies. We freeze the % bands (version-stable inputs), NOT the dollar grid
-- (dollars are still derived at close against the already-frozen set_time_balance_cents).
--
-- D — WHY: createSprint inserted the sprint row and its tasks as two separate
-- statements; a task-insert failure left a zero-task ACTIVE sprint occupying the
-- sprints_one_active_per_user slot (0008). create_sprint_atomic does both inserts in
-- one transaction (mirrors replay_user_projection) so a task failure rolls the sprint
-- insert back.
--
-- No SCORING_VERSION bump: sprints are version-stable (sprint_closes freezes the
-- OUTCOME, replay re-emits it verbatim). No backfill: 0 open/queued sprints exist and
-- closeSprint falls back to current config for any null payoff_bands.

alter table public.sprints
  add column if not exists payoff_bands  jsonb,    -- ordered [{upToRatio,label,pct}] for THIS size
  add column if not exists goal_bonus_pct numeric; -- upside-only goal bonus % for THIS size

create or replace function public.create_sprint_atomic(p_sprint jsonb, p_tasks jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.sprints (
    user_id, size, area, thesis, term_days, status, queue_position,
    set_time_balance_cents, scoring_version, opened_at, payoff_bands, goal_bonus_pct
  )
  values (
    (p_sprint->>'user_id')::uuid,
    p_sprint->>'size',
    p_sprint->>'area',
    p_sprint->>'thesis',
    (p_sprint->>'term_days')::smallint,
    p_sprint->>'status',
    nullif(p_sprint->>'queue_position', '')::int,
    (p_sprint->>'set_time_balance_cents')::bigint,
    (p_sprint->>'scoring_version')::int,
    nullif(p_sprint->>'opened_at', '')::timestamptz,
    p_sprint->'payoff_bands',
    (p_sprint->>'goal_bonus_pct')::numeric
  )
  returning id into v_id;

  insert into public.sprint_tasks (user_id, sprint_id, title, due_day, position)
  select
    (p_sprint->>'user_id')::uuid,
    v_id,
    t->>'title',
    nullif(t->>'due_day', '')::int,
    (t->>'position')::int
  from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb)) as t;

  return v_id; -- a task-insert failure raises → the sprint insert rolls back with it
end;
$$;

revoke execute on function public.create_sprint_atomic(jsonb, jsonb) from public;
revoke execute on function public.create_sprint_atomic(jsonb, jsonb) from anon;
revoke execute on function public.create_sprint_atomic(jsonb, jsonb) from authenticated;

notify pgrst, 'reload schema';

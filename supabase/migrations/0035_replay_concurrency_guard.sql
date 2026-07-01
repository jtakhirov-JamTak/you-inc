-- 0035_replay_concurrency_guard — serialize per-user replays + reject stale swaps.
--
-- WHY: replay_user_projection (0031) had no advisory lock and no optimistic guard.
-- Two near-simultaneous settleUser calls for one user could orphan a just-frozen week:
-- caller B computes its ledger payload from a snapshot set that predates caller A's
-- freeze, then B's delete+reinsert drops A's week's ledger rows without reinserting
-- them (B never computed them). The settleUser short-circuit (!hasNewWeek &&
-- !versionGap) would then skip re-deriving that week — a frozen settled_weeks row with
-- no ledger rows, indefinitely.
--
-- FIX: (1) pg_advisory_xact_lock on the user id serializes replays (auto-released at
-- commit/rollback). (2) An optimistic guard rejects a payload computed from a stale
-- read — if a concurrent replay froze a NEWER week than the caller observed, or a newer
-- deploy already replayed at a HIGHER scoring_version, raise 'replay_stale' so the
-- caller re-reads + recomputes + retries (see runner.ts). The guard only REJECTS, never
-- mutates, so idempotency holds: same facts + same version → byte-identical rows.
-- (The settleUser Phase-1 orphan self-heal, added in the same change, re-enters replay
-- for any pre-existing orphan.)
--
-- Adds two params → drop the 4-arg signature first so it isn't left as a callable overload.

drop function if exists public.replay_user_projection(uuid, jsonb, jsonb, jsonb);

create or replace function public.replay_user_projection(
  p_user_id uuid,
  p_ledger_rows jsonb,
  p_board_rows jsonb,
  p_settled_weeks jsonb,
  p_observed_max_week int,
  p_scoring_version int
) returns void
language plpgsql
as $$
declare
  v_current_max int;
begin
  -- Serialize replays for this user (xact-scoped; releases on commit/rollback).
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- OPTIMISTIC GUARD 1: a concurrent replay froze a newer settled week than the caller
  -- saw → its ledger rows would be deleted but not reinserted (the caller never computed
  -- them). Bail so the caller re-reads and retries with the full week set.
  select max(week_index) into v_current_max
    from public.settled_weeks where user_id = p_user_id;
  if v_current_max is not null
     and p_observed_max_week is not null
     and v_current_max > p_observed_max_week then
    raise exception 'replay_stale';
  end if;

  -- OPTIMISTIC GUARD 2: a newer deploy already replayed at a higher scoring version →
  -- don't let a stale (lower-version) payload overwrite it.
  if exists (
    select 1 from public.price_ledger
     where user_id = p_user_id
       and event_type in ('habit_week_settled', 'streak_bonus', 'recovery_bonus', 'collapse_penalty')
       and scoring_version > p_scoring_version
  ) then
    raise exception 'replay_stale';
  end if;

  -- 0. FREEZE the newly-elapsed week snapshots in the SAME transaction as the swap.
  --    Write-once; a week already frozen (retry or concurrent settle) is left untouched.
  insert into public.settled_weeks (
    user_id, week_index, week_start, week_end, days_in_week, positions
  )
  select
    p_user_id,
    (s->>'week_index')::int,
    (s->>'week_start')::date,
    (s->>'week_end')::date,
    (s->>'days_in_week')::int,
    coalesce(s->'positions', '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_settled_weeks, '[]'::jsonb)) as s
  on conflict (user_id, week_index) do nothing;

  -- 1. Swap the rebuildable valuation rows.
  delete from public.price_ledger
   where user_id = p_user_id
     and event_type in (
       'habit_week_settled', 'streak_bonus', 'recovery_bonus',
       'collapse_penalty', 'sprint_realized'
     );

  insert into public.price_ledger (
    user_id, event_type, settlement_key, amount_cents, pct, basis_cents,
    scoring_version, occurred_at, metadata
  )
  select
    p_user_id,
    r->>'event_type',
    r->>'settlement_key',
    (r->>'amount_cents')::bigint,
    (r->>'pct')::numeric,
    (r->>'basis_cents')::bigint,
    (r->>'scoring_version')::int,
    (r->>'occurred_at')::timestamptz,
    coalesce(r->'metadata', '{}'::jsonb)
  from jsonb_array_elements(p_ledger_rows) as r;

  -- 2. Update ONLY the derived columns of board_meetings; never delete.
  insert into public.board_meetings (
    user_id, week_index, closing_value_cents, week_delta_cents,
    area_contributions, settled_at
  )
  select
    p_user_id,
    (b->>'week_index')::int,
    (b->>'closing_value_cents')::bigint,
    (b->>'week_delta_cents')::bigint,
    coalesce(b->'area_contributions', '{}'::jsonb),
    (b->>'settled_at')::timestamptz
  from jsonb_array_elements(p_board_rows) as b
  on conflict (user_id, week_index) do update set
    closing_value_cents = excluded.closing_value_cents,
    week_delta_cents    = excluded.week_delta_cents,
    area_contributions  = excluded.area_contributions,
    settled_at          = excluded.settled_at;
end;
$$;

-- SECURITY: service-role only (takes arbitrary row payloads + writes the ledger).
revoke execute on function public.replay_user_projection(uuid, jsonb, jsonb, jsonb, int, int) from public;
revoke execute on function public.replay_user_projection(uuid, jsonb, jsonb, jsonb, int, int) from anon;
revoke execute on function public.replay_user_projection(uuid, jsonb, jsonb, jsonb, int, int) from authenticated;

notify pgrst, 'reload schema';

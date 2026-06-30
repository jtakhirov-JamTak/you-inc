-- 0030_replay_user_projection — the ATOMIC valuation rebuild.
--
-- A SCORING_VERSION bump (or a newly-settled week) recomputes a user's whole ledger
-- from the frozen facts (settled_weeks + sprint_closes) under the current constants.
-- That rewrite MUST be all-or-nothing: a crash mid-replay (week 6 of 10 inserted)
-- would leave a mixed-version ledger — the exact state the version guard exists to
-- prevent. Supabase's JS client can't run an interactive multi-statement
-- transaction, so the delete+reinsert lives in this one plpgsql function, whose body
-- runs in a single implicit transaction (any raise rolls the whole thing back).
--
-- The runner computes the new rows in TypeScript (pure foldSettlements over the
-- frozen snapshots) and passes them in as jsonb. This function only swaps storage.
--
-- WHAT IT TOUCHES:
--   • price_ledger — deletes the user's REBUILDABLE rows (habit-week family +
--     sprint payoffs, the latter re-emitted from sprint_closes) and reinserts the
--     recomputed set. FACT tables (settled_weeks, sprint_closes, habit_logs) and any
--     other ledger event types are left untouched.
--   • board_meetings — a HYBRID row: derived columns (closing/delta/area) live
--     beside user-authored `note`, AI `analysis_*`, and FK-cascading
--     board_resolutions. It is NEVER deleted — only the derived columns are updated
--     in place, preserving everything the user/AI wrote.

create or replace function public.replay_user_projection(
  p_user_id uuid,
  p_ledger_rows jsonb,
  p_board_rows jsonb
) returns void
language plpgsql
as $$
begin
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

  -- 2. Update ONLY the derived columns of board_meetings; never delete (would erase
  --    the user note, the AI analysis, and cascade board_resolutions).
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

-- SECURITY: this function takes arbitrary row payloads and writes the ledger, so it
-- must NOT be callable by end users via PostgREST RPC — only the service role (which
-- the price engine uses) may invoke it.
revoke execute on function public.replay_user_projection(uuid, jsonb, jsonb) from public;
revoke execute on function public.replay_user_projection(uuid, jsonb, jsonb) from anon;
revoke execute on function public.replay_user_projection(uuid, jsonb, jsonb) from authenticated;

notify pgrst, 'reload schema';

-- 0031_replay_freezes_atomically — fold the settled_weeks FREEZE into the replay RPC.
--
-- Before: settleUser did TWO round-trips — (1) upsert the new settled_weeks
-- snapshots (freeze the facts), then (2) call replay_user_projection to swap the
-- ledger. If (1) committed but (2) failed (network/timeout/crash between them), the
-- week was frozen but its events never reached price_ledger. On the next quiet load
-- the short-circuit sees the week in settled_weeks (nothing "new") and no version gap
-- → returns WITHOUT replaying → the ledger stays short that week until a later new
-- week or version bump re-enters the replay branch (up to ~a week; indefinite for a
-- paused user). The projection-model's "a partial projection re-converges next run"
-- invariant didn't hold for this window.
--
-- After: the new-week snapshots are passed INTO the RPC and inserted as step 0 of the
-- SAME implicit transaction as the ledger swap. Freeze + valuation now commit
-- all-or-nothing: a failed replay rolls the freeze back too, so the next load simply
-- re-detects the week as new and retries the whole atomic unit. Same reasoning that
-- already put the ledger delete+reinsert in one function.
--
-- The insert is ON CONFLICT DO NOTHING (idempotent, matching the old ignore-on-
-- conflict upsert): a week another concurrent settle already froze is left as-is, and
-- because the runner now filters newWeeks against the freshly-read snapshot set, the
-- recomputed ledger stays consistent with whatever settled_weeks ends up holding.

-- Replace the 3-arg function with a 4-arg one (drop first — adding a parameter would
-- otherwise create a second overload and leave the old signature callable).
drop function if exists public.replay_user_projection(uuid, jsonb, jsonb);

create or replace function public.replay_user_projection(
  p_user_id uuid,
  p_ledger_rows jsonb,
  p_board_rows jsonb,
  p_settled_weeks jsonb
) returns void
language plpgsql
as $$
begin
  -- 0. FREEZE the newly-elapsed week snapshots in the SAME transaction as the swap.
  --    Write-once: a week already frozen (by us on a retry, or a concurrent settle)
  --    is left untouched. This is the freeze anchor 0029's trigger reads.
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

-- SECURITY: unchanged from 0030 — this function takes arbitrary row payloads and
-- writes the ledger + freezes facts, so ONLY the service role may invoke it.
revoke execute on function public.replay_user_projection(uuid, jsonb, jsonb, jsonb) from public;
revoke execute on function public.replay_user_projection(uuid, jsonb, jsonb, jsonb) from anon;
revoke execute on function public.replay_user_projection(uuid, jsonb, jsonb, jsonb) from authenticated;

notify pgrst, 'reload schema';

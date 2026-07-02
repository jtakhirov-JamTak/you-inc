-- 0037_close_sprint_atomic — make the sprint close one transaction.
--
-- WHY: closeSprint performed FOUR sequential service-role writes (sprint_closes
-- fact → price_ledger row → sprints status update → queue promotion). Two
-- concurrent closes with different goalAchieved could interleave: the fact/ledger
-- writes are first-write-wins (idempotent inserts) while the sprints update is
-- last-write-wins and had no status compare-and-set — so the sprint row could
-- disagree with the frozen fact it supposedly records. A promotion failure was
-- also swallowed (logged only), stranding the queue with no active sprint.
--
-- The old fact-FIRST ordering was a deliberate self-healing design (a crash after
-- the fact write left a durable replay source and the retry no-op'd the fact).
-- This RPC preserves that crash-safety by a stronger means — all five steps commit
-- or roll back together — and ADDS winner selection: the status CAS in step 2 runs
-- BEFORE any fact write, so a losing concurrent close aborts without writing
-- anything, and fact + ledger + sprint row always come from ONE computation.
--
-- The payoff MATH stays in TypeScript (bandFromFrozen against the row's frozen
-- bands, engine.ts money helpers) — this function is transactional plumbing only;
-- it writes exactly the values the caller computed (mirrors create_sprint_atomic's
-- jsonb-payload convention from 0034).
--
-- SECURITY: service-role only (0031/0034/0035 convention) — it takes arbitrary row
-- payloads and writes the ledger. search_path intentionally omitted, matching the
-- sibling functions (all refs public.-qualified; the function_search_path_mutable
-- advisor WARN is a known, accepted state).

create or replace function public.close_sprint_atomic(
  p_user_id   uuid,
  p_sprint_id uuid,
  p_close     jsonb,        -- sprint_closes fact fields + realized_band for the sprint row
  p_ledger    jsonb,        -- the sprint_realized price_ledger row fields
  p_now       timestamptz   -- closed_at / the promoted sprint's opened_at
) returns uuid               -- the promoted queued sprint's id, or null
language plpgsql
as $$
declare
  v_rows     int;
  v_promoted uuid;
begin
  -- 1. Serialize per user — same key scheme as replay_user_projection (0035), so a
  --    close also serializes against a concurrent replay's ledger swap.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- 2. WINNER SELECTION (CAS): only the transaction that flips active→closed may
  --    write the fact. A concurrent close that lost the race matches zero rows and
  --    aborts here, BEFORE any fact/ledger write — its (possibly different)
  --    goalAchieved computation writes nothing.
  update public.sprints
     set status                = 'closed',
         closed_at             = p_now,
         goal_achieved         = (p_close->>'goal_achieved')::boolean,
         realized_band         = p_close->>'realized_band',
         realized_pct          = (p_close->>'realized_pct')::numeric,
         realized_amount_cents = (p_close->>'realized_amount_cents')::bigint
   where id = p_sprint_id
     and user_id = p_user_id
     and status = 'active';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'sprint_not_active';
  end if;

  -- 3. The FROZEN close fact (Layer 1, the replay source — re-emitted verbatim;
  --    sprint payoffs are version-stable). on conflict do nothing is belt and
  --    suspenders: the CAS above already guarantees a single writer.
  insert into public.sprint_closes (
    user_id, sprint_id, frozen_basis_cents, tasks_done, tasks_total,
    goal_achieved, area, realized_pct, realized_amount_cents,
    closed_local_date, metadata
  ) values (
    p_user_id,
    p_sprint_id,
    (p_close->>'frozen_basis_cents')::bigint,
    (p_close->>'tasks_done')::int,
    (p_close->>'tasks_total')::int,
    (p_close->>'goal_achieved')::boolean,
    nullif(p_close->>'area', ''),
    (p_close->>'realized_pct')::numeric,
    (p_close->>'realized_amount_cents')::bigint,
    (p_close->>'closed_local_date')::date,
    coalesce(p_close->'metadata', '{}'::jsonb)
  )
  on conflict (user_id, sprint_id) do nothing;

  -- 4. The derived projection row (idempotent by settlement_key; a replay
  --    reproduces this exact row from the fact above).
  insert into public.price_ledger (
    user_id, event_type, settlement_key, amount_cents, pct, basis_cents,
    scoring_version, occurred_at, metadata
  ) values (
    p_user_id,
    'sprint_realized',
    p_ledger->>'settlement_key',
    (p_ledger->>'amount_cents')::bigint,
    (p_ledger->>'pct')::numeric,
    (p_ledger->>'basis_cents')::bigint,
    (p_ledger->>'scoring_version')::int,
    (p_ledger->>'occurred_at')::timestamptz,
    coalesce(p_ledger->'metadata', '{}'::jsonb)
  )
  on conflict (user_id, settlement_key) do nothing;

  -- 5. Promote the next queued sprint (lowest queue_position) to active. INSIDE the
  --    transaction: a promotion failure (e.g. the one-active unique index) now rolls
  --    back the whole close and surfaces as an error the client retries — never a
  --    silently-stranded queue under a closed sprint.
  update public.sprints s
     set status = 'active', opened_at = p_now, queue_position = null
   where s.id = (
     select q.id
       from public.sprints q
      where q.user_id = p_user_id
        and q.status = 'queued'
      order by q.queue_position asc nulls last
      limit 1
   )
  returning s.id into v_promoted;

  return v_promoted; -- null when nothing was queued
end;
$$;

revoke execute on function public.close_sprint_atomic(uuid, uuid, jsonb, jsonb, timestamptz) from public;
revoke execute on function public.close_sprint_atomic(uuid, uuid, jsonb, jsonb, timestamptz) from anon;
revoke execute on function public.close_sprint_atomic(uuid, uuid, jsonb, jsonb, timestamptz) from authenticated;

notify pgrst, 'reload schema';

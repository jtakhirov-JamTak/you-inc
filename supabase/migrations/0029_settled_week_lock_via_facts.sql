-- 0029_settled_week_lock_via_facts — RE-BASE the habit_logs write-lock from the
-- price_ledger (now a REBUILDABLE projection) onto settled_weeks (an immutable FACT).
--
-- WHY: 0011 froze a week's logs because a `habit_week_settled` LEDGER row existed.
-- Under the projection model the ledger is deleted-and-reinserted on every replay
-- (see 0030), so keying the freeze off it would transiently UNLOCK all of history
-- mid-rebuild — the exact window an edit could slip through and desync raw from the
-- booked value. settled_weeks is written ONCE when a week passes its grace day and
-- is never rewritten, so it is the stable anchor.
--
-- BEHAVIOUR CHANGE (intended): a week's logs are now frozen iff a settled_weeks row
-- exists whose [week_start, week_end] contains the log's local_date. Because that
-- row is written at the GRACE boundary (the day AFTER the calendar week ends — see
-- weeks.ts SETTLEMENT_GRACE_DAYS), the user keeps the whole grace day to fix the
-- just-closed week's logs (forgot to log, travel, sickness, late entry). Before the
-- fact exists, writes pass; after it exists, they raise settled_week_locked → 409.
--
-- The trigger object itself (habit_logs_settled_week_lock, BEFORE INSERT/DELETE on
-- habit_logs) was created in 0011 and is bound to this function name; CREATE OR
-- REPLACE swaps the body in place — no trigger re-creation needed.

create or replace function public.reject_settled_week_log()
returns trigger
language plpgsql
as $$
declare
  v_user uuid;
  v_date date;
begin
  if tg_op = 'DELETE' then
    v_user := old.user_id;
    v_date := old.local_date;
  else
    v_user := new.user_id;
    v_date := new.local_date;
  end if;

  -- Frozen iff a settled-week FACT covers this date. The subquery is scoped by
  -- user_id (correct under both the RLS user client and the service role).
  if exists (
    select 1
    from public.settled_weeks sw
    where sw.user_id = v_user
      and v_date between sw.week_start and sw.week_end
  ) then
    -- Distinct message so the API maps it to a friendly 409 (see /api/habits/log).
    raise exception 'settled_week_locked' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';

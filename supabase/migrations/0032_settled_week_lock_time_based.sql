-- 0032_settled_week_lock_time_based — move the habit_logs write-lock from the lazily
-- written settled_weeks FACT onto WALL-CLOCK TIME, so a week's logs freeze at the real
-- grace boundary even if the user never opens the app (closing the backfill/tamper
-- window that 0029 left open until the next settling app-open).
--
-- WHY: 0029 froze a week iff a settled_weeks row covered the log's local_date. That row
-- is written LAZILY inside replay_user_projection (0031) only on an app-open past the
-- grace boundary. A user who never opens the app leaves every elapsed week UNLOCKED,
-- so a backdated insert/delete could still rewrite a week that should be closed. This
-- computes the freeze purely from now() in the user's timezone: a log's week is locked
-- once today (local) has moved strictly past week_end + grace.
--
-- Value settlement stays LAZY and unchanged: settled_weeks is still written by the
-- replay RPC and remains the replay snapshot source. This migration alters ONLY the
-- lock predicate. A week can now be time-locked BEFORE its settled_weeks row exists —
-- that is the intended fix; because logs are frozen at the boundary, the later lazy
-- settle folds exactly the logs that were present at the boundary (more correct than
-- before, where logs could still change between the boundary and the settling load).
--
-- The trigger object (habit_logs_settled_week_lock, BEFORE INSERT/DELETE on habit_logs)
-- from 0011 is bound to this function name; CREATE OR REPLACE swaps the body in place.
-- UPDATE stays out of scope (append-only table; corrections are new rows / a future
-- voided_at UPDATE path the trigger must not block).
--
-- COUPLING: c_grace_days below MUST stay in sync with SETTLEMENT_GRACE_DAYS in
-- src/lib/price/config.ts (=1). Postgres cannot import the TS constant; if that value
-- is ever tuned, bump it here in a follow-up migration. The week-start math mirrors
-- weeks.ts weekStartOf(); dow/getUTCDay()/extract(dow) all share 0=Sun..6=Sat.
-- search_path is intentionally omitted, matching the sibling functions in this repo
-- (all refs are public.-qualified; the pre-existing function_search_path_mutable
-- advisor WARN is a known, accepted state).

create or replace function public.reject_settled_week_log()
returns trigger
language plpgsql
as $$
declare
  v_user       uuid;
  v_date       date;
  v_tz         text;
  v_week_start int;
  v_today      date;
  v_dow        int;
  v_wk_start   date;
  v_wk_end     date;
  c_grace_days constant int := 1; -- keep in sync with SETTLEMENT_GRACE_DAYS
begin
  if tg_op = 'DELETE' then
    v_user := old.user_id;
    v_date := old.local_date;
  else
    v_user := new.user_id;
    v_date := new.local_date;
  end if;

  -- The user's local-day settings. Defaults mirror user_settings' own column defaults
  -- (UTC / Monday=1) so a missing row degrades safely instead of raising.
  select coalesce(us.timezone, 'UTC'), coalesce(us.week_start, 1)
    into v_tz, v_week_start
    from public.user_settings us
   where us.user_id = v_user;
  if not found then
    v_tz := 'UTC';
    v_week_start := 1;
  end if;

  -- Today's local calendar date in the user's tz. AT TIME ZONE is DST-correct.
  v_today := (now() at time zone v_tz)::date;

  -- Start of the settlement week containing this log's local_date, matching
  -- weeks.ts weekStartOf(): delta = (dow(d) - week_start + 7) % 7; week_start = d-delta.
  -- (dow - ws + 7) is always positive (both in 0..6 → 1..13) so % 7 needs no guard.
  v_dow      := extract(dow from v_date)::int;
  v_wk_start := v_date - ((v_dow - v_week_start + 7) % 7);
  v_wk_end   := v_wk_start + 6;

  -- Locked once today has moved STRICTLY past the grace boundary, matching weeks.ts
  -- isPastGrace: compareLocalDate(currentLocal, wkEnd + GRACE) > 0.
  if v_today > v_wk_end + c_grace_days then
    raise exception 'settled_week_locked' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';

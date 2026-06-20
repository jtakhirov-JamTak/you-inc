-- 0011_settled_week_write_lock — freeze a week's raw habit_logs once it has
-- settled into the append-only, idempotent price_ledger.
--
-- WHY: the ledger books a week ONCE under a deterministic settlement_key
-- (habit_week:{i}). A later edit to that week's habit_logs can never re-settle
-- (the unique (user_id, settlement_key) + ignoreDuplicates block a redo), so the
-- raw log would silently diverge from the booked number and break
-- rebuild-from-raw. This makes a settled week's logs immutable at the DB layer —
-- every write path, not just the API endpoint.
--
-- HOW: a week is "settled" iff a habit_week_settled ledger row exists for the
-- user. That row's occurred_at IS the week-end (the runner writes weekEnd
-- T12:00:00Z), so the week's local-date range is [weekEnd-6, weekEnd]. The ledger
-- already carries the boundary — no week-index / timezone / signup recomputation.
--
-- SCOPE: BEFORE INSERT/DELETE on habit_logs. The subquery is explicitly scoped by
-- user_id (correct under both the RLS user client and the service role); the
-- price_ledger RLS policy is a redundant second guard. UPDATE is intentionally
-- omitted — habit_logs has no UPDATE policy (RLS denies it) and corrections are
-- new rows by convention.

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

  if exists (
    select 1
    from public.price_ledger pl
    where pl.user_id = v_user
      and pl.event_type = 'habit_week_settled'
      and v_date between (pl.occurred_at at time zone 'UTC')::date - 6
                     and (pl.occurred_at at time zone 'UTC')::date
  ) then
    -- Distinct message so the API can map it to a friendly 409.
    raise exception 'settled_week_locked' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists habit_logs_settled_week_lock on public.habit_logs;
create trigger habit_logs_settled_week_lock
  before insert or delete on public.habit_logs
  for each row execute function public.reject_settled_week_log();

notify pgrst, 'reload schema';

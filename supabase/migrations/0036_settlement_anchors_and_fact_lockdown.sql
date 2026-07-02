-- 0036_settlement_anchors_and_fact_lockdown — freeze the settlement time anchors and
-- close the direct-PostgREST write paths into the frozen-fact tables.
--
-- WHY (three trust-boundary holes):
--   (a) The week grid that indexes IMMUTABLE frozen facts (settled_weeks.week_index)
--       is derived from MUTABLE inputs: user_settings.timezone auto-syncs from the
--       browser (TimezoneSync), week_start is editable, and "week 0" hangs off
--       user_profiles.created_at converted through that live timezone. Ordinary
--       travel could re-grid weekIndex under frozen rows. Fix: copy the three into
--       frozen anchor columns the engine reads instead, locked once anything frozen
--       exists.
--   (b) settled_weeks / sprint_closes / sprints carried owner INSERT (and for
--       sprints UPDATE/DELETE) policies, so an authenticated user could forge
--       accounting facts via direct PostgREST that settleUser then launders into
--       the ledger. All legitimate writes already go through service-role code
--       (replay_user_projection, closeSprint, create_sprint_atomic) — verified by
--       grep before this migration. Fix: drop the end-user write policies.
--   (c) habit_logs' future-date check lived only in the API route and was
--       bypassable via direct REST. Fix: a BEFORE INSERT trigger backstop.
--
-- ANCHOR LOCK TIMING (founder ruling): anchors are seeded at signup (UTC defaults —
-- the browser zone isn't known server-side yet) and stay MUTABLE, tracking the
-- /api/settings/timezone sync, until the user's FIRST frozen fact (a settled_weeks
-- or sprint_closes row) exists. Locking at signup would freeze 'UTC' before
-- TimezoneSync ever posts the real zone — permanently reinstating the UTC
-- day-rollover bug fixed in 8b1783e. Pre-lock re-gridding is harmless: nothing
-- frozen references the week grid yet. Once a fact exists the anchors are
-- immutable to end users forever (service role stays exempt for admin repair).
--
-- ENFORCEMENT MECHANISM: a conditional BEFORE UPDATE trigger rather than
-- column-level grants — the lock depends on DATA STATE (does a frozen fact exist
-- for this user?), which static grants cannot express. End-user requests are
-- identified by the PostgREST JWT role claim ('authenticated'/'anon'); service-role
-- requests carry role='service_role' and direct connections (migrations, psql)
-- carry no claims — both exempt.
--
-- search_path is intentionally omitted on the functions, matching the sibling
-- functions in this repo (all refs are public.-qualified; the pre-existing
-- function_search_path_mutable advisor WARN is a known, accepted state).

-- ── 1. Anchor columns ────────────────────────────────────────────────────────────
-- Defaults double as the signup seed: handle_new_user (0004) inserts only
-- (user_id), so new rows pick these up — 'UTC'/Monday mirroring the live columns'
-- own defaults, and signup_local_date = today in UTC (at signup the live timezone
-- IS 'UTC', so this matches the backfill formula exactly). No trigger change
-- needed; the same signup path seeds the anchors before any first settlement.
alter table public.user_settings
  add column if not exists settlement_timezone text not null default 'UTC',
  add column if not exists settlement_week_start smallint not null default 1
    check (settlement_week_start between 0 and 6),
  add column if not exists signup_local_date date not null
    default ((now() at time zone 'UTC')::date);

-- Backfill existing users from the live values they settle under today, so the
-- switch to frozen anchors is value-preserving (same tz/week_start/signup date →
-- same week grid → same weekIndex for every frozen row). signup_local_date mirrors
-- runner.ts's localDateInTz(profile.created_at, tz); the coalesce degrades to the
-- settings row's own created_at if a profile row is somehow missing.
update public.user_settings us
   set settlement_timezone   = us.timezone,
       settlement_week_start = us.week_start,
       signup_local_date     = coalesce(
         (select (up.created_at at time zone us.timezone)::date
            from public.user_profiles up
           where up.id = us.user_id),
         (us.created_at at time zone us.timezone)::date
       );

-- ── 2. Who is asking? ────────────────────────────────────────────────────────────
-- True only for end-user PostgREST requests (JWT role 'authenticated' or 'anon').
-- Service-role requests ('service_role') and direct DB connections (no claims —
-- migrations, psql, admin) are NOT end users. Shared by the anchor lock and the
-- sprint_tasks guard below.
create or replace function public.is_end_user_request()
returns boolean
language plpgsql
stable
as $$
declare
  v_role text;
begin
  begin
    v_role := coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    );
  exception when others then
    -- Malformed claims → treat as a direct connection (not an end user).
    v_role := '';
  end;
  return v_role in ('authenticated', 'anon');
end;
$$;

-- ── 3. Anchor lock trigger ───────────────────────────────────────────────────────
create or replace function public.lock_settlement_anchors()
returns trigger
language plpgsql
as $$
begin
  if (new.settlement_timezone   is distinct from old.settlement_timezone
      or new.settlement_week_start is distinct from old.settlement_week_start
      or new.signup_local_date     is distinct from old.signup_local_date)
     and public.is_end_user_request()
     -- The lock arms at the FIRST frozen fact: settled week snapshots and realized
     -- sprint closes are the two write-once fact tables the week grid / close dates
     -- must stay consistent with.
     and (exists (select 1 from public.settled_weeks sw where sw.user_id = old.user_id)
          or exists (select 1 from public.sprint_closes sc where sc.user_id = old.user_id))
  then
    raise exception 'settlement_anchors_locked' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists user_settings_anchor_lock on public.user_settings;
create trigger user_settings_anchor_lock
  before update on public.user_settings
  for each row execute function public.lock_settlement_anchors();

-- ── 4. Re-base the settled-week log lock onto the FROZEN anchors ─────────────────
-- Same body as 0032 (the trigger object habit_logs_settled_week_lock from 0011 is
-- bound to this name; CREATE OR REPLACE swaps it in place); only the tz/week-start
-- SOURCE moves from the live columns to the frozen anchors, so a browser-synced
-- timezone change can no longer move the lock boundary. The coalesce chain is
-- belt-and-suspenders (the anchor columns are NOT NULL); a missing settings row
-- still degrades to UTC/Monday instead of raising.
--
-- COUPLING (unchanged from 0032): c_grace_days MUST stay in sync with
-- SETTLEMENT_GRACE_DAYS in src/lib/price/config.ts (=1). The week-start math
-- mirrors weeks.ts weekStartOf(); parity is pinned in
-- src/lib/price/__tests__/settled-week-lock.test.ts.
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

  -- FROZEN settlement anchors (0036) — never the live, browser-synced columns.
  select coalesce(us.settlement_timezone, us.timezone, 'UTC'),
         coalesce(us.settlement_week_start, us.week_start, 1)
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

-- ── 5. Fact-table lockdown ───────────────────────────────────────────────────────
-- Drop the end-user write policies; with RLS enabled and no matching policy, these
-- writes are denied for authenticated/anon. SELECT policies are untouched. The
-- service role bypasses RLS, so replay_user_projection / closeSprint /
-- create_sprint_atomic keep working unchanged.
drop policy if exists settled_weeks_insert_own on public.settled_weeks;
drop policy if exists sprint_closes_insert_own on public.sprint_closes;
drop policy if exists sprints_insert_own on public.sprints;
drop policy if exists sprints_update_own on public.sprints;
drop policy if exists sprints_delete_own on public.sprints;

-- ── 6. habit_logs future-date backstop ───────────────────────────────────────────
-- The API route rejects future-dated logs with a friendly 400; this trigger is the
-- backstop for direct REST inserts (which RLS otherwise permits — habit_logs is the
-- sanctioned self-report input layer). "Today" is computed in the FROZEN settlement
-- timezone: you can't have done something on a day that hasn't happened yet on the
-- clock that scores it. Applies to every role — a future-dated log is invalid
-- regardless of who writes it. INSERT only: deletes don't create facts, and the
-- settled-week lock above already guards both.
create or replace function public.reject_future_habit_log()
returns trigger
language plpgsql
as $$
declare
  v_tz    text;
  v_today date;
begin
  select coalesce(us.settlement_timezone, us.timezone, 'UTC')
    into v_tz
    from public.user_settings us
   where us.user_id = new.user_id;
  if not found then
    v_tz := 'UTC';
  end if;

  begin
    v_today := (now() at time zone v_tz)::date;
  exception when others then
    -- A bogus stored zone must not brick logging; degrade to UTC like the engine.
    v_today := (now() at time zone 'UTC')::date;
  end;

  if new.local_date > v_today then
    raise exception 'future_dated_log' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists habit_logs_future_date_guard on public.habit_logs;
create trigger habit_logs_future_date_guard
  before insert on public.habit_logs
  for each row execute function public.reject_future_habit_log();

-- ── 7. sprint_tasks write guard ──────────────────────────────────────────────────
-- The task list prices the sprint payoff (completion % → band), so its SHAPE is
-- part of the priced surface: end users may only toggle done/done_at on existing
-- rows (the sanctioned /api/sprints/task route), and may add/remove rows only while
-- the parent sprint is still pre-active (draft/queued — nothing priced yet).
-- Service role is exempt: task creation happens inside create_sprint_atomic, and
-- admin repair must stay possible.
create or replace function public.guard_sprint_tasks()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  if not public.is_end_user_request() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Only done / done_at may change; everything else is frozen for end users.
    if new.id         is distinct from old.id
       or new.user_id    is distinct from old.user_id
       or new.sprint_id  is distinct from old.sprint_id
       or new.title      is distinct from old.title
       or new.position   is distinct from old.position
       or new.created_at is distinct from old.created_at
    then
      raise exception 'sprint_task_fields_locked' using errcode = '23514';
    end if;
    return new;
  end if;

  -- INSERT / DELETE: allowed only while the parent sprint is pre-active.
  if tg_op = 'DELETE' then
    select s.status into v_status from public.sprints s where s.id = old.sprint_id;
  else
    select s.status into v_status from public.sprints s where s.id = new.sprint_id;
  end if;
  if v_status is null or v_status not in ('draft', 'queued') then
    raise exception 'sprint_tasks_locked' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists sprint_tasks_write_guard on public.sprint_tasks;
create trigger sprint_tasks_write_guard
  before insert or update or delete on public.sprint_tasks
  for each row execute function public.guard_sprint_tasks();

-- New functions must never be callable as RPCs by end users (0003 convention).
-- (Trigger execution does not require the caller to hold EXECUTE.)
revoke execute on function public.is_end_user_request() from public, anon, authenticated;
revoke execute on function public.lock_settlement_anchors() from public, anon, authenticated;
revoke execute on function public.reject_future_habit_log() from public, anon, authenticated;
revoke execute on function public.guard_sprint_tasks() from public, anon, authenticated;

notify pgrst, 'reload schema';

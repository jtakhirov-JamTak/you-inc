-- 0012_price_ledger_settled_week_index — support the settled-week write lock.
--
-- The 0011 trigger runs, on EVERY habit_logs insert/delete, an EXISTS subquery:
--   from price_ledger where user_id = ? and event_type = 'habit_week_settled'
--   and <date in [weekEnd-6, weekEnd]>
-- The existing indexes (user_id; user_id, occurred_at) force the planner to scan
-- all of a user's ledger rows and post-filter event_type. This PARTIAL index
-- covers only the habit_week_settled rows (excluding streak/recovery/collapse/
-- sprint events), so the lookup is a small, targeted (user_id, occurred_at) scan.
--
-- Negligible today (a few hundred ledger rows/user); this keeps the write-path
-- check cheap as the ledger grows.

create index if not exists price_ledger_settled_week_idx
  on public.price_ledger (user_id, occurred_at)
  where event_type = 'habit_week_settled';

notify pgrst, 'reload schema';

-- 0013_sprint_task_due_day — per-task milestone day within the sprint term.
--
-- Each sprint task gets a due_day (1..14, the day within the term it's expected by).
-- The LIVE unrealized return only counts a task against you once its milestone day
-- has ended undone; done tasks count immediately; not-yet-due tasks are neutral.
-- Additive + nullable so any pre-existing task is treated as due at term end (it only
-- resolves at close). The realized payoff at close is unchanged (done / total).

alter table public.sprint_tasks
  add column if not exists due_day smallint check (due_day between 1 and 14);

notify pgrst, 'reload schema';

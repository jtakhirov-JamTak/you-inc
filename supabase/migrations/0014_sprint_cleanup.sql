-- 0014_sprint_cleanup — drop the dead locked_grid column; harden the queue.
--
-- locked_grid was denormalized onto each sprint at create but never read back: the
-- dollar payoff grid is derived on demand from (size, set_time_balance_cents,
-- scoring_version) via buildSprintGrid. A written-and-ignored copy can only diverge
-- from the live one if the band table ever changes, so remove it.
alter table public.sprints drop column if exists locked_grid;

-- The queue slot is computed read-then-write as max(queue_position)+1; a partial
-- unique index makes two queued sprints unable to share a slot under a race. The
-- one-active invariant is already guarded by sprints_one_active_per_user (0008).
create unique index if not exists sprints_one_queue_pos_per_user
  on public.sprints (user_id, queue_position)
  where status = 'queued';

notify pgrst, 'reload schema';

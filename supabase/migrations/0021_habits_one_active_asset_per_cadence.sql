-- 0021_habits_one_active_asset_per_cadence — DB backstop for the fixed roster.
--
-- The roster's "1 morning + 1 daily + 1 weekly asset" cap was enforced ONLY at
-- the app layer (validateRosterAddition), which the create route itself flagged
-- as racy ("two truly simultaneous creates could both pass … a partial unique
-- index can harden it later", api/habits/route.ts). The guided year-goal flow is
-- the second consumer and is MORE exposed: it does replace-then-insert, so a
-- double-submit / retry could leave the user with two active weekly assets —
-- silently breaking the fixed-roster invariant the (irreversible) price engine
-- assumes. This index makes the second concurrent insert fail with 23505, which
-- the routes map to a 409 (mirrors graduated_habits_user_source_unique, 0017).
--
-- Scoped to ACTIVE ASSETS: liabilities have a null cadence and a separate ≤2 cap;
-- replaced/retired/graduated rows are exempt so a freed slot can be refilled.

create unique index if not exists habits_one_active_asset_per_cadence
  on public.habits (user_id, cadence)
  where status = 'active' and kind = 'asset';

notify pgrst, 'reload schema';

-- 0003_lock_down_handle_new_user — revoke direct EXECUTE on the signup trigger fn.
--
-- handle_new_user() (added in 0002) is SECURITY DEFINER and lives in `public`,
-- so PostgREST exposes it as /rest/v1/rpc/handle_new_user, callable by the
-- `anon` and `authenticated` roles. It is only ever meant to run as the
-- on_auth_user_created trigger, never as a user-invoked RPC. Revoke EXECUTE so
-- it is not part of the public API surface. The trigger is unaffected — it
-- fires as the function owner during the auth.users insert, independent of
-- these role grants.

revoke execute on function public.handle_new_user() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- 0002_user_profile_on_signup — auto-create a user_profiles row per new auth user.
--
-- The foundation (0001) created the user_profiles table but no path that
-- populates it (the old onboarding flow that did so was stripped on extract).
-- This adds a server-side trigger so every signup gets exactly one profile row,
-- with no app code required. Idempotent: on conflict do nothing.

-- SECURITY DEFINER so it can write the profile during the auth.users insert,
-- when there is no end-user auth context and RLS would otherwise block it.
-- search_path is pinned to '' (empty) per Supabase lint guidance, so every
-- object reference must be schema-qualified.
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.user_profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill any existing auth users that predate the trigger (e.g. the founder's
-- own test account created right after the project was wired up).
insert into public.user_profiles (id)
select id from auth.users
on conflict (id) do nothing;

notify pgrst, 'reload schema';

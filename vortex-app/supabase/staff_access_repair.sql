-- Staff writes refused across the whole app: club_state (which is squads, fee plans, race
-- splits, the meets calendar and everything else the club shares), attendance_marks,
-- family_accounts. All of them are guarded by vx_is_staff(), so when that answers false for a
-- coach, everything they do is refused at once and it looks like the database has forgotten
-- them.
--
-- This rebuilds the answer from scratch rather than inspecting it further. Run it whole, once.
-- Safe to re-run, and it grants staff to nobody who is not already on one of the club's own
-- two lists.

-- ---------------------------------------------------------------------------------- the list
create table if not exists public.vx_staff_emails (email text primary key);

insert into public.vx_staff_emails (email)
  select distinct lower(trim(email)) from public.staff_accounts
   where coalesce(trim(email), '') <> ''
on conflict (email) do nothing;

-- The managers whose accounts are built into the app rather than staff_accounts, so nothing
-- above picks them up.
insert into public.vx_staff_emails (email) values
  (lower('ahmedmamot@gmail.com')),
  (lower('sameh@vortexswimmingclub.com')),
  (lower('Sameh4142@gmail.com'))
on conflict (email) do nothing;

-- An address stored with a capital never matched a check that lowercased only the other side.
update public.vx_staff_emails set email = lower(trim(email)) where email <> lower(trim(email));

-- ------------------------------------------------------------------------------- the answer
-- Replaced outright, because reading the old one has cost more time than rewriting it. Two
-- sources, either of which makes someone staff: the allowlist above, and any staff_accounts row
-- carrying that email — so a coach added to the club after this file was last run is staff
-- immediately, instead of silently losing every save until somebody remembers to re-run it.
--
-- SECURITY DEFINER matters: vx_staff_emails is staff-only to read, so without it this function
-- reads the list as the caller, finds nothing, and answers false for everybody for ever.
create or replace function public.vx_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select exists (
      select 1 from public.vx_staff_emails e
       where lower(trim(e.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
    ) or exists (
      select 1 from public.staff_accounts s
       where lower(trim(coalesce(s.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
    )
    where coalesce(trim(auth.jwt() ->> 'email'), '') <> ''
  ), false);
$$;

revoke all on function public.vx_is_staff() from public;
grant execute on function public.vx_is_staff() to anon, authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------------- check it
-- Every account that has signed in, and whether this rebuilt answer counts them as staff.
-- The row for the person seeing the banner must say true.
select u.email,
       (exists (select 1 from public.vx_staff_emails e where lower(trim(e.email)) = lower(trim(u.email)))
        or exists (select 1 from public.staff_accounts s where lower(trim(coalesce(s.email,''))) = lower(trim(u.email)))) as is_staff
  from auth.users u
 order by u.last_sign_in_at desc nulls last
 limit 25;

-- Then, in the app: Check the reader → "Database says I am staff". That line asks this same
-- function over the app's own sign-in, which is the only version of the question that decides
-- whether a save goes in. If it still says NO after this, the app is not reaching the database
-- as you at all — sign out and back in, and the held changes save themselves.

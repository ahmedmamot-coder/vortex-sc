-- Why the app says "new row violates row-level security policy for table family_accounts".
--
-- Nothing is broken and nothing is lost. The account is signed in — that part works — but the
-- database decides who is staff by ONE thing: whether the email in the sign-in token is in
-- vx_staff_emails. If it is not, vx_is_staff() is false, and every policy written as
-- "staff, or your own row" refuses the write. A manager writing other families' rows is
-- exactly the case that refuses.
--
-- It shows up as HTTP 401 with a retry that can never work, because retrying does not change
-- who the database thinks you are.
--
-- Run this in the Supabase SQL editor. Safe to re-run. It reports before it changes anything.

-- ---------------------------------------------------------------------------- 1. the answer
-- Who the database currently accepts as staff.
select email, note from public.vx_staff_emails order by email;

-- Everyone who has ever signed in, and whether the database counts them as staff. The row for
-- the person seeing the banner is the one that matters: if `is_staff` is false, that is the
-- whole fault.
select u.email,
       (exists (select 1 from public.vx_staff_emails e where e.email = lower(trim(u.email)))) as is_staff,
       u.last_sign_in_at
  from auth.users u
 order by u.last_sign_in_at desc nulls last
 limit 25;

-- ------------------------------------------------------------------------------- 2. the fix
-- Anybody with a staff account row and an email is staff. This is the same fill security_4_roles
-- does, run again — a coach added since that file was last run is missing until it is.
insert into public.vx_staff_emails (email, note)
  select distinct lower(trim(email)), 'from staff_accounts'
    from public.staff_accounts
   where coalesce(trim(email),'') <> ''
on conflict (email) do nothing;

-- The two managers whose accounts are built into the app rather than staff_accounts, so
-- nothing above picks them up.
insert into public.vx_staff_emails (email, note) values
  (lower('ahmedmamot@gmail.com'), 'Ahmed — manager, built-in account'),
  (lower('Sameh4142@gmail.com'),  'Sameh — manager, built-in account')
on conflict (email) do nothing;

-- An address stored with a capital in it never matched. The check lowercases the email coming
-- out of the sign-in token but compared it against this column as it was stored, so one row
-- typed as "Coach@..." locked that coach out with everything looking correct on both sides.
update public.vx_staff_emails
   set email = lower(trim(email))
 where email <> lower(trim(email));

-- And stop it mattering again: compare both sides the same way, for good.
create or replace function public.vx_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.vx_staff_emails e
     where lower(trim(e.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
       and coalesce(trim(auth.jwt() ->> 'email'), '') <> ''
  );
$$;
revoke all on function public.vx_is_staff() from public;
grant execute on function public.vx_is_staff() to anon, authenticated;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------------------------ 3. check it
-- Run this SIGNED IN AS THE PERSON WHO SAW THE BANNER, from the app's own database session —
-- or just re-open the app: the queued changes save themselves the moment this returns true.
--   select public.vx_is_staff();
--
-- If a coach is still refused, their sign-in email is not in the list above. Add it by hand:
--   insert into public.vx_staff_emails (email, note)
--   values (lower('their.email@example.com'), 'added by hand')
--   on conflict (email) do nothing;
select email, note from public.vx_staff_emails order by email;

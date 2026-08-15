-- "new row violates row-level security policy for table family_accounts", while the account is
-- signed in and its email IS in the staff list.
--
-- The staff list being right is not the same as vx_is_staff() returning true. Four things have
-- to line up, and the club has hit at least one of them wrong before:
--
--   1. vx_is_staff() exists at all.
--   2. It is SECURITY DEFINER. Without that it reads vx_staff_emails as the signed-in user —
--      and vx_staff_emails is itself staff-only to read, so the check needs to already be true
--      to come out true. It returns false for everyone, for ever, and the list looks perfect.
--   3. It compares the email the same way on both sides.
--   4. The policy on family_accounts is actually the one that consults it.
--
-- STEP 1 reports. It changes nothing. Run it first and read the answer before running STEP 2.

-- ============================================================ STEP 1 — what is actually there
select 'vx_is_staff' as item,
       coalesce((select case when p.prosecdef then 'exists · SECURITY DEFINER (correct)'
                             else 'exists · NOT security definer — this alone refuses everybody' end
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'vx_is_staff'),
                'MISSING — every policy that calls it refuses the write') as value
union all
select 'vx_staff_emails columns',
       coalesce((select string_agg(column_name, ', ' order by ordinal_position)
                   from information_schema.columns
                  where table_schema = 'public' and table_name = 'vx_staff_emails'),
                'MISSING — the table itself is not there')
union all
select 'vx_staff_emails RLS',
       coalesce((select case when c.relrowsecurity then 'on — only matters if vx_is_staff is not security definer'
                             else 'off' end
                   from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = 'vx_staff_emails'), '—')
union all
select 'family_accounts policies',
       coalesce((select string_agg(policyname || ' [' || cmd || '] check=' || coalesce(with_check, '-'), '  |  ')
                   from pg_policies where schemaname = 'public' and tablename = 'family_accounts'),
                'none — the table has no policies at all')
union all
select 'vx_is_staff source',
       coalesce((select pg_get_functiondef(p.oid)
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'vx_is_staff'), '—');


-- ============================================================ STEP 2 — the repair
-- Run this after reading STEP 1. Safe to re-run. It does not drop anything.
--
-- The table is created only if it is missing, and the email column is the only one assumed:
-- this club's table has no `note` column, and an insert naming one fails outright.

create table if not exists public.vx_staff_emails (email text primary key);

-- Everyone who has a staff account row with an email on it.
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

-- SECURITY DEFINER is the line that matters. vx_staff_emails is staff-only to read, so without
-- it this function reads the list as the signed-in user, finds nothing, and answers false —
-- which is a check that can never become true no matter who is added to the list.
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

-- ============================================================ STEP 3 — confirm
-- Re-run STEP 1. vx_is_staff must read "exists · SECURITY DEFINER (correct)", and the
-- family_accounts policies must mention vx_is_staff() in their check.
--
-- Then reopen the app: the queued changes save themselves the moment the answer is true.
select email from public.vx_staff_emails order by email;

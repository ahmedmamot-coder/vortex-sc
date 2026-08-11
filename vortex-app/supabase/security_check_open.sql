-- What is actually readable without signing in — and what is merely granted to `public`.
--
-- The obvious check is wrong, and it was the one I gave first:
--
--     select * from pg_policies where roles::text like '%public%';
--
-- That flags a policy like `to public using (is_staff())`, which is not open at all: `public`
-- includes `anon`, but is_staff() is false for anybody not signed in, so every row is filtered
-- out anyway. It returned 45 rows on this database and almost all of them were fine. A check
-- that cries wolf is worse than no check, because the next real finding is in the same list.
--
-- What makes a policy open is the EXPRESSION, not the role — and which expression depends on
-- the command. A SELECT policy is governed by `qual` alone; an INSERT policy by `with_check`
-- alone (its qual is always null, which is normal and not a finding); UPDATE and ALL by both.

-- ---------------------------------------------------------------------------------------------
-- 1) Genuinely open to anyone, signed in or not. THIS is the list that matters.
-- ---------------------------------------------------------------------------------------------
select tablename, policyname, cmd, roles,
       coalesce(qual, '(n/a)')       as using_expression,
       coalesce(with_check, '(n/a)') as check_expression
  from pg_policies
 where schemaname = 'public'
   and (roles::text like '%anon%' or roles::text like '%public%')
   and (
        (cmd in ('SELECT','DELETE') and coalesce(btrim(qual), 'true') = 'true')
     or (cmd = 'INSERT'             and coalesce(btrim(with_check), 'true') = 'true')
     or (cmd in ('UPDATE','ALL')    and (coalesce(btrim(qual), 'true') = 'true'
                                      or coalesce(btrim(with_check), 'true') = 'true'))
   )
 order by tablename, policyname;

-- ---------------------------------------------------------------------------------------------
-- 2) A table with row-level security switched OFF is wide open regardless of policies, and
--    shows up in no policy listing at all — so it is the one thing the query above cannot find.
-- ---------------------------------------------------------------------------------------------
select c.relname as table_without_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false
 order by c.relname;

-- ---------------------------------------------------------------------------------------------
-- 3) Every table, whether it is protected, and roughly how much is in it.
--
--    This database holds two different sets of table names: the ones the app writes to
--    (attendance_marks, inbody_readings, plan_sessions, memberships …) and another set from an
--    earlier design (attendance, inbody_scans, plans, plan_sets, meets, personal_bests,
--    profiles, family_links …). Stage 4 only ever named the first set, so the second was never
--    locked down — and until we know which of them holds live data, neither "it is protected"
--    nor "it is empty, ignore it" can be said honestly.
--
--    reltuples is the planner's estimate and reads -1 for a table never analysed; the exact
--    count query below settles any table this leaves in doubt.
-- ---------------------------------------------------------------------------------------------
select c.relname            as table_name,
       c.relrowsecurity     as rls_on,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies,
       c.reltuples::bigint  as approx_rows
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by c.relname;

-- Exact counts for anything ambiguous above — slower, so run it once and read it:
--   select 'attendance' t, count(*) from public.attendance
--   union all select 'attendance_marks', count(*) from public.attendance_marks
--   union all select 'inbody_scans',     count(*) from public.inbody_scans
--   union all select 'inbody_readings',  count(*) from public.inbody_readings
--   union all select 'plans',            count(*) from public.plans
--   union all select 'plan_sessions',    count(*) from public.plan_sessions;

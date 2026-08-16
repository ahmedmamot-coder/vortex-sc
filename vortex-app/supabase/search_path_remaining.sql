-- Every function in `public`, whether its search_path is pinned, and whether that matters.
--
-- advisor_fixes.sql pinned 12 functions and the advisor immediately stopped naming is_staff and
-- started naming family_accounts_fill_full_name instead. That is not the fix failing — it is the
-- advisor moving on to the next one, because Supabase's lint flags EVERY function in `public`
-- without a pinned path, while advisor_fixes.sql deliberately pinned only the security-definer
-- ones. Those were the ones that could actually be exploited, and they were fixed first on purpose.
--
-- The difference is worth being clear about, because "12 pinned, advisor still complaining" reads
-- like nothing happened:
--
--   security definer  — runs with its OWNER's privileges. An unqualified name inside it is
--                       resolved with the CALLER's search_path, so whoever can create a table
--                       earlier on that path decides what that name means while running as the
--                       owner. This is privilege escalation. All 12 are now pinned.
--
--   runs as caller    — the ordinary kind, including trigger functions like
--                       family_accounts_fill_full_name. A caller who redirects a name inside one
--                       of these only redirects it for themselves, with their own privileges, and
--                       gains nothing they did not already have. Worth pinning for tidiness and a
--                       clean advisor, not worth losing sleep over ten days before launch.
--
-- Section 1 reports. Section 2 pins the rest, and is commented out — read section 1 first.

-- ================================================================================ 1. what is left
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as function_name,
       case when p.prosecdef then '⚠ security definer' else 'runs as caller' end as kind,
       case when exists (select 1 from unnest(coalesce(p.proconfig,'{}'::text[])) c
                          where c like 'search\_path=%')
            then '✓ pinned' else '✗ mutable' end as search_path,
       case when p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig,'{}'::text[])) c
                                              where c like 'search\_path=%')
            then 'FIX THIS — run advisor_fixes.sql'
            when not exists (select 1 from unnest(coalesce(p.proconfig,'{}'::text[])) c
                              where c like 'search\_path=%')
            then 'tidy-up only — no privilege to gain'
            else '' end as verdict
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
 where ns.nspname = 'public'
   and p.prokind = 'f'                      -- functions and trigger functions, not aggregates
 order by p.prosecdef desc,
          (exists (select 1 from unnest(coalesce(p.proconfig,'{}'::text[])) c where c like 'search\_path=%')),
          p.proname;

-- ============================================================== 2. pin the remaining ones as well
-- Remove the /* */ to run it. It pins every function in `public` that still has no path — the
-- run-as-caller ones left over — which clears the advisor entirely.
--
-- One caution, and it is the reason this is not on by default: pinning a function to
-- `public, pg_temp` changes what an unqualified name inside it resolves to. A function written to
-- read a table in another schema through a search_path set by its caller would stop finding it.
-- Nothing in this club's SQL does that, and section 1 lists exactly what would be touched — read
-- that list first, and if every name on it is one of yours, this is safe.

/*
do $$
declare f record; n int := 0;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.prokind = 'f'
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
                        where c like 'search\_path=%')
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
    raise notice 'pinned search_path on %', f.sig;
    n := n + 1;
  end loop;
  raise notice '% function(s) pinned', n;
end $$;
*/

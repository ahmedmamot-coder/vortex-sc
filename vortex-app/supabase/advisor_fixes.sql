-- Pin the search_path on every security-definer function that is missing one.
--
-- This file does one thing, on purpose. It used to carry the duplicate-index report as well, and
-- that report had a bug — so the editor, which runs a script as a single transaction, rolled the
-- whole thing back and pinned nothing. A repair and a report have no business sharing a
-- transaction. The report now lives in duplicate_indexes.sql.
--
-- ------------------------------------------------------------------------------ what and why
--
-- `public.is_staff` is flagged "Function Search Path Mutable", and it is not the function that was
-- pinned before. There are two:
--
--   * vx_is_staff()  — what proto.html's policies call. Pinned in security_4_roles.sql. Fine.
--   * is_staff()     — from 0001_init.sql, what the family_links and profiles policies call.
--                      `security definer`, no search_path. Never pinned.
--
-- A `security definer` function runs with the privileges of whoever created it, and this one
-- resolves the bare name `profiles`. Without a pinned search_path, which table that name lands on
-- depends on the caller — so anyone who can create a table in a schema earlier on that path
-- decides what "profiles" means while running as the owner. The function's whole job is answering
-- "is this person staff", so the answer is the thing at stake.
--
-- is_staff() is not alone. is_admin_or_head(), linked_swimmer_ids() and search_swimmers() have the
-- same shape and the same gap — and search_swimmers is the one to look at hardest, because it is
-- granted to `authenticated`, so every parent in the club can call it, and it resolves `swimmers`
-- and `squads` unqualified while running as the owner.
--
-- Two of those four were found by this file, not by reading the code, which is why it pins every
-- security-definer function in `public` that is missing a path rather than naming the ones we
-- happen to know about. The next one added would be missing it too.
--
-- Idempotent: a function already pinned is skipped. Changes no logic and no data.

do $$
declare f record; n int := 0;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.prosecdef                                   -- security definer only
       and not exists (
             select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
              where c like 'search\_path=%')
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
    raise notice 'pinned search_path on %', f.sig;
    n := n + 1;
  end loop;
  if n = 0 then raise notice 'nothing to pin — every security definer function already has one';
  else raise notice '% function(s) pinned', n; end if;
end $$;

-- Read the Messages tab: it names each function it pinned. Then run this to see the result —
-- every row must say ✓.
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as function_name,
       case when exists (select 1 from unnest(coalesce(p.proconfig,'{}'::text[])) c
                          where c like 'search\_path=%')
            then '✓ pinned' else '✗ STILL MUTABLE' end as status
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
 where ns.nspname = 'public' and p.prosecdef
 order by 2, 1;

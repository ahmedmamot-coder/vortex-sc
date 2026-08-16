-- The two things Supabase's advisor found that are worth acting on.
--
-- Section 1 CHANGES the database, safely and reversibly. Section 2 changes nothing at all — it
-- reports, and hands back the exact statements to run once you have read them.
--
-- ==================================================== 1. security definer without a pinned path
--
-- `public.is_staff` is flagged "Function Search Path Mutable", and it is not the function that was
-- pinned before. There are two:
--
--   * vx_is_staff()  — what proto.html's policies call. Pinned in security_4_roles.sql. Fine.
--   * is_staff()     — from 0001_init.sql, what the family_links and profiles policies call.
--                      `security definer`, no search_path. Never pinned.
--
-- Why it matters: a `security definer` function runs with the privileges of whoever created it,
-- and this one resolves the bare name `profiles`. Without a pinned search_path, which table that
-- name lands on depends on the caller's search_path — so anyone who can create a table in a
-- schema earlier on that path decides what "profiles" means while running as the owner. The
-- function's whole job is answering "is this person staff", so the answer is the thing at stake.
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

-- Read the Messages tab after running this: it names each function it pinned.

-- ============================================================== 2. the duplicate indexes, listed
--
-- attendance_marks is the busiest table in the club — a row per swimmer per session, written by
-- every coach on every register. A duplicate index means every one of those writes maintains two
-- identical indexes instead of one, for no gain at all. swimmer_docs is the same, for photos.
--
-- This DROPS NOTHING. It groups the indexes by what they actually index, shows every group with
-- more than one, and writes out the drop statement for the spare — never for an index backing a
-- primary key or a unique constraint, because dropping one of those removes the rule, not just
-- the index. Read the `drop_this` column, check the name, then run it yourself.

with idx as (
  select ci.relname                                   as index_name,
         ct.relname                                   as table_name,
         pg_get_indexdef(i.indexrelid)                as def,
         (select c.conname from pg_constraint c where c.conindid = i.indexrelid) as backs_constraint,
         pg_relation_size(i.indexrelid)               as bytes
    from pg_index i
    join pg_class ci on ci.oid = i.indexrelid
    join pg_class ct on ct.oid = i.indrelid
    join pg_namespace ns on ns.oid = ci.relnamespace
   where ns.nspname = 'public'
),
shaped as (
  -- Everything after the index's own name: the table, the method and the columns. Two indexes
  -- with the same shape are the same index under two names.
  select *, regexp_replace(def, '^CREATE (UNIQUE )?INDEX [^ ]+ ON ', '') as shape from idx
),
dupes as (
  select table_name, shape, count(*) as copies,
         array_agg(index_name order by (backs_constraint is not null) desc, bytes desc, index_name) as names,
         array_agg(backs_constraint order by (backs_constraint is not null) desc, bytes desc, index_name) as cons
    from shaped
   group by table_name, shape
  having count(*) > 1
)
select table_name,
       copies,
       array_to_string(names, ', ')                                as indexes_on_the_same_columns,
       coalesce(names[1] || coalesce(' (keeps constraint ' || cons[1] || ')', ''), '')
                                                                   as keep_this,
       case when cons[2] is not null
            then '— second one backs constraint ' || cons[2] || ', do NOT drop it'
            else 'drop index concurrently public.' || names[2] || ';'
       end                                                         as drop_this,
       shape                                                       as indexed
  from dupes
 order by table_name;

-- `concurrently` so the table is never locked while it runs — attendance is being marked at the
-- poolside and must not stop. It cannot run inside a transaction block, so run that one statement
-- on its own, not pasted in with anything else.

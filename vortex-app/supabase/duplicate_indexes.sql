-- The duplicate indexes, listed. DROPS NOTHING.
--
-- attendance_marks is the busiest table in the club — a row per swimmer per session, written by
-- every coach on every register — and Supabase's advisor says it carries a duplicate index. Every
-- one of those writes then maintains two identical indexes instead of one, for no gain at all.
-- swimmer_docs is the same, for photos and documents.
--
-- This groups the indexes by what they actually index, shows every group with more than one, and
-- writes out the drop statement for the spare. Read the `drop_this` column, check the name, then
-- run that statement yourself.
--
-- ---------------------------------------------------------------------------------------------
-- The first version of this query failed with "more than one row returned by a subquery used as
-- an expression", and the reason is worth keeping: pg_constraint.conindid is NOT only set on the
-- constraint that OWNS an index. Every foreign key that REFERENCES a unique index carries that
-- index's oid too — so a primary key referenced by several foreign keys returns several rows.
-- Hence the filter to contype in ('p','u','x'), which are the three that actually own one.
--
-- It also used to sit in the same file as the search_path repair. The editor runs a script as one
-- transaction, so this error rolled that repair back and nothing was pinned. Separate files now.

with idx as (
  select ci.relname                    as index_name,
         ct.relname                    as table_name,
         pg_get_indexdef(i.indexrelid) as def,
         pg_relation_size(i.indexrelid) as bytes,
         -- Only p (primary key), u (unique) and x (exclusion) own an index. f (foreign key)
         -- merely points at one, and counting those is what broke this query.
         (select string_agg(c.conname, ', ')
            from pg_constraint c
           where c.conindid = i.indexrelid
             and c.contype in ('p','u','x'))  as backs_constraint
    from pg_index i
    join pg_class ci     on ci.oid = i.indexrelid
    join pg_class ct     on ct.oid = i.indrelid
    join pg_namespace ns on ns.oid = ci.relnamespace
   where ns.nspname = 'public'
),
shaped as (
  -- Everything after the index's own name: the table, the method, the columns. Two indexes with
  -- the same shape are the same index under two names.
  select *, regexp_replace(def, '^CREATE (UNIQUE )?INDEX [^ ]+ ON ', '') as shape from idx
),
dupes as (
  select table_name, shape, count(*) as copies,
         -- Constraint-backed first, then largest: whatever is kept should be the one carrying a
         -- rule, and the spare should be the one that is only an index.
         array_agg(index_name      order by (backs_constraint is not null) desc, bytes desc, index_name) as names,
         array_agg(backs_constraint order by (backs_constraint is not null) desc, bytes desc, index_name) as cons
    from shaped
   group by table_name, shape
  having count(*) > 1
)
select table_name,
       copies,
       array_to_string(names, ', ')                                          as indexes_on_the_same_columns,
       names[1] || coalesce(' (backs constraint ' || cons[1] || ')', '')      as keep_this,
       case when cons[2] is not null
            then '— the second one backs constraint ' || cons[2] || ', do NOT drop it'
            else 'drop index concurrently public.' || names[2] || ';'
       end                                                                    as drop_this,
       shape                                                                  as indexed
  from dupes
 order by table_name;

-- `concurrently` so the table is never locked while it runs — attendance is being marked at the
-- poolside and must not stop. It cannot run inside a transaction block, so run that one statement
-- on its own, not pasted in with anything else.
--
-- Nothing at all comes back if there are no duplicates left to find.

-- ------------------------------------------------------------------- and the same thing, readable
-- The table above has six columns and the one that matters is the last, so in a browser it is cut
-- off exactly where the index name would be — which is the one word somebody has to copy. This
-- returns nothing but the statements, one per row, with nothing to the right of them to truncate.
with idx as (
  select ci.relname as index_name, ct.relname as table_name,
         pg_get_indexdef(i.indexrelid) as def, pg_relation_size(i.indexrelid) as bytes,
         (select string_agg(c.conname, ', ') from pg_constraint c
           where c.conindid = i.indexrelid and c.contype in ('p','u','x')) as backs_constraint
    from pg_index i
    join pg_class ci on ci.oid = i.indexrelid
    join pg_class ct on ct.oid = i.indrelid
    join pg_namespace ns on ns.oid = ci.relnamespace
   where ns.nspname = 'public'
),
shaped as (select *, regexp_replace(def, '^CREATE (UNIQUE )?INDEX [^ ]+ ON ', '') as shape from idx),
dupes as (
  select table_name,
         array_agg(index_name       order by (backs_constraint is not null) desc, bytes desc, index_name) as names,
         array_agg(backs_constraint order by (backs_constraint is not null) desc, bytes desc, index_name) as cons
    from shaped group by table_name, shape having count(*) > 1
)
select case when cons[2] is not null
            then '-- ' || names[2] || ' backs constraint ' || cons[2] || ' — leave it alone'
            else 'drop index concurrently public.' || names[2] || ';'
       end as run_these_one_at_a_time
  from dupes
 order by 1;

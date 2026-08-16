-- Did the repair actually take? One query, one result table.
--
-- plan_tables_repair.sql ends with two checks, and the SQL editor only ever shows the last one —
-- so the nine-column check is run and then hidden by the row counts underneath it. This asks both
-- questions at once and returns a single table, which is the one that can actually be read.
--
-- Reads the catalogue only. Writes nothing, changes nothing, safe during training.
--
-- Every row must say ✓. A row saying ✗ is a column the app writes and the database has not got,
-- which means every write to that table is refused with a 400 and the work stays on the phone.

with want(t, col) as (values
  ('fitness_plans','plan'),('fitness_plans','ts'),('fitness_plans','updated_at'),
  ('squad_plans','plan'),('squad_plans','ts'),('squad_plans','updated_at'),
  ('season_plans','season'),('season_plans','ts'),('season_plans','updated_at')
),
have as (
  select w.t, w.col, (a.attname is not null) as ok
    from want w
    left join pg_attribute a
           on a.attrelid = to_regclass('public.'||w.t)
          and a.attname  = w.col
          and a.attnum > 0 and not a.attisdropped
),
rows_now as (
  select 'fitness_plans' as t, count(*) as n from public.fitness_plans
  union all select 'squad_plans',  count(*) from public.squad_plans
  union all select 'season_plans', count(*) from public.season_plans
)
select h.t                                    as table_name,
       h.col                                  as column_name,
       case when h.ok then '✓' else '✗ MISSING — writes to this table are refused' end as status,
       r.n                                    as rows_in_table
  from have h
  join rows_now r on r.t = h.t
 order by h.ok, h.t, h.col;

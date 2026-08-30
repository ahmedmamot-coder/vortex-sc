-- fitness_plans still has the id column from the very first migration, and the app has never
-- been able to write to it.
--
-- Every squad in this app is a slug: seniora, vortexld, preteam. squad_plans.id is text and
-- takes them. season_plans.id is text and takes them. fitness_sessions.id is text and holds 45
-- rows. fitness_plans.id is uuid, so every save a coach makes comes back
--
--   HTTP 400 · invalid input syntax for type uuid: "seniora"
--
-- and the row never lands. Not once, for as long as the table has existed: the table holds a
-- single row, seeded with the original uuid shape, and its plan column is null.
--
-- plan_tables_repair.sql added the plan/ts/updated_at columns this table was missing, which
-- fixed the READ. Nothing fixed the write, so the read now succeeds and finds nothing, and
-- every coach's dryland plan lives on the one phone it was typed on.
--
-- squad_id has the same problem one step further on: uuid, NOT NULL, and a foreign key to
-- squads(id). The app does not send it and could not satisfy it if it did — its squad ids are
-- not uuids. So the column stops being required rather than being dropped, and the one legacy
-- row keeps everything it has.
--
-- Safe to run twice: every step checks the shape before it changes it, and no row is deleted.

do $$
begin
  -- id: uuid -> text, so a squad slug is a valid primary key.
  if (select data_type from information_schema.columns
        where table_schema='public' and table_name='fitness_plans' and column_name='id') = 'uuid' then
    alter table public.fitness_plans alter column id type text using id::text;
  end if;

  -- squad_id: the app never writes it, and NOT NULL makes every insert fail even once id is text.
  if exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='fitness_plans'
                 and column_name='squad_id' and is_nullable='NO') then
    alter table public.fitness_plans alter column squad_id drop not null;
  end if;

  -- The foreign key cannot be satisfied by anything this app sends, and a row it rejects is a
  -- plan a coach loses.
  if exists (select 1 from pg_constraint
               where conrelid='public.fitness_plans'::regclass and conname='fitness_plans_squad_id_fkey') then
    alter table public.fitness_plans drop constraint fitness_plans_squad_id_fkey;
  end if;

  -- sections is NOT NULL with a default, which is fine, but the app writes `plan` and never
  -- `sections`; the default is what keeps the insert legal.
  null;
end $$;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------------------------------ check it
-- id must say text, and squad_id must say YES. Both rows have to be right before a plan saves.
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema='public' and table_name='fitness_plans' and column_name in ('id','squad_id')
 order by column_name;

-- And the same shape as the two tables that already work, for comparison.
select table_name, data_type as id_type
  from information_schema.columns
 where table_schema='public' and column_name='id'
   and table_name in ('fitness_plans','squad_plans','season_plans','fitness_sessions')
 order by table_name;

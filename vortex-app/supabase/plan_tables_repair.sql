-- The three plan tables, brought up to the shape the app writes.
--
-- fitness_plans exists in this club's database, holds a row, and answered 400 to
-- `select=id,plan,ts,updated_at` every single time it was asked. One of those columns is not
-- there. The read therefore failed, the app fell back to the copy on the device, and every
-- coach's fitness plan stayed on the phone it was typed on — for as long as that has been true,
-- with the error scrolling past in a console nobody has open at the poolside.
--
-- squad_plans and season_plans are the same shape and were read the same way, so they get the
-- same treatment before they do the same thing.
--
-- `add column if not exists` does nothing to a column that is already there, so this is safe to
-- run on a database that is already correct, and safe to run twice. It adds no data and changes
-- no row.

alter table public.fitness_plans
  add column if not exists plan       jsonb,
  add column if not exists ts         bigint,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.squad_plans
  add column if not exists plan       jsonb,
  add column if not exists ts         bigint,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.season_plans
  add column if not exists season     jsonb,
  add column if not exists ts         bigint,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

notify pgrst, 'reload schema';

-- ------------------------------------------------------------------------------------ check it
-- Every column the app writes, and whether it is now there. All nine rows must say ✓.
with want(t, col) as (values
  ('fitness_plans','plan'),('fitness_plans','ts'),('fitness_plans','updated_at'),
  ('squad_plans','plan'),('squad_plans','ts'),('squad_plans','updated_at'),
  ('season_plans','season'),('season_plans','ts'),('season_plans','updated_at')
)
select w.t as table_name, w.col as column_name,
       case when a.attname is null then '✗ STILL MISSING' else '✓' end as status
  from want w
  left join pg_attribute a
         on a.attrelid = to_regclass('public.'||w.t)
        and a.attname = w.col and a.attnum > 0 and not a.attisdropped
 order by (a.attname is null) desc, w.t, w.col;

-- And what is actually in them now. A coach's fitness plan reaching the database at all is the
-- thing that has not been happening.
select 'fitness_plans' as t, count(*) from public.fitness_plans
union all select 'squad_plans', count(*) from public.squad_plans
union all select 'season_plans', count(*) from public.season_plans;

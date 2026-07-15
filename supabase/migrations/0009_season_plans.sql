-- Season / periodization plan per squad: one row per squad (same reliable pattern
-- as squad_plans / chat / staff), so each coach's season plan saves on its own row
-- and syncs across devices without clobbering. Holds the whole season document
-- (name, start date, phases with weeks + load, and target meets) as JSON.

create table if not exists public.season_plans (
  id         text primary key,   -- squad id
  season     jsonb,
  ts         bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.season_plans enable row level security;

grant select, insert, update, delete on public.season_plans to anon, authenticated;

drop policy if exists season_plans_read   on public.season_plans;
drop policy if exists season_plans_insert on public.season_plans;
drop policy if exists season_plans_update on public.season_plans;

create policy season_plans_read   on public.season_plans for select to anon, authenticated using (true);
create policy season_plans_insert on public.season_plans for insert to anon, authenticated with check (true);
create policy season_plans_update on public.season_plans for update to anon, authenticated using (true) with check (true);

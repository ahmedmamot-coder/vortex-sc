-- Live training plan per squad: one row per squad (like the chat / staff / family
-- tables), so plan edits from different squads or devices never overwrite each other.
-- The whole editable plan (sections, sets, and every per-set field: reps, distance,
-- circuit rounds, type/stroke/tools/zone, focus labels, groups, send-off, rest, HR,
-- tagged swimmers) is stored as one JSON document keyed by the squad id.

create table if not exists public.squad_plans (
  id         text primary key,   -- squad id (e.g. "seniora")
  plan       jsonb,
  ts         bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.squad_plans enable row level security;

grant select, insert, update, delete on public.squad_plans to anon, authenticated;

drop policy if exists squad_plans_read   on public.squad_plans;
drop policy if exists squad_plans_insert on public.squad_plans;
drop policy if exists squad_plans_update on public.squad_plans;

create policy squad_plans_read   on public.squad_plans for select to anon, authenticated using (true);
create policy squad_plans_insert on public.squad_plans for insert to anon, authenticated with check (true);
create policy squad_plans_update on public.squad_plans for update to anon, authenticated using (true) with check (true);

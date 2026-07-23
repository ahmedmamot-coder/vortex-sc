-- ============================================================================
--  VORTEX SC — hr_sets : manually logged training heart-rate for a set/test
--  (avg + max bpm), e.g. from a Polar Verity Sense or a wall pulse check.
--  One row per logged set, synced to every device. Safe to re-run.
--  Paste into Supabase -> SQL Editor -> Run.
-- ============================================================================
create table if not exists public.hr_sets (
  id         text primary key,
  sw_id      text,
  date       text,                 -- yyyy-mm-dd
  label      text,                 -- the set, e.g. "8x100 free @1:30"
  avg_hr     int,
  max_hr     int,
  note       text,
  ts         bigint,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists hr_sets_sw_idx   on public.hr_sets (sw_id);
create index if not exists hr_sets_date_idx on public.hr_sets (date desc);
alter table public.hr_sets enable row level security;
grant select, insert, update, delete on public.hr_sets to anon, authenticated;
drop policy if exists hr_read   on public.hr_sets;
drop policy if exists hr_insert on public.hr_sets;
drop policy if exists hr_update on public.hr_sets;
drop policy if exists hr_delete on public.hr_sets;
create policy hr_read   on public.hr_sets for select to anon, authenticated using (true);
create policy hr_insert on public.hr_sets for insert to anon, authenticated with check (true);
create policy hr_update on public.hr_sets for update to anon, authenticated using (true) with check (true);
create policy hr_delete on public.hr_sets for delete to anon, authenticated using (true);

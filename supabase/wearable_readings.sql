-- ============================================================================
--  VORTEX SC — wearable_readings : per-swimmer daily recovery/HR/sleep data
--  (WHOOP / Fitbit style). One row per swimmer per day, so it never overwrites
--  another swimmer's data and never bloats the synced blob. Safe to re-run.
--  Paste into Supabase -> SQL Editor -> Run.
-- ============================================================================
create table if not exists public.wearable_readings (
  id         text primary key,          -- swId + '_' + date (one row per swimmer per day)
  sw_id      text,
  date       text,                      -- yyyy-mm-dd
  recovery   int,                       -- 0..100 %
  rhr        int,                       -- resting heart rate (bpm)
  hrv        int,                       -- heart-rate variability (ms)
  sleep_h    numeric,                   -- hours slept
  strain     numeric,                   -- 0..21 day strain
  source     text,                      -- 'manual' | 'whoop' | 'fitbit'
  ts         bigint,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists wearable_sw_idx   on public.wearable_readings (sw_id);
create index if not exists wearable_date_idx on public.wearable_readings (date desc);
alter table public.wearable_readings enable row level security;
grant select, insert, update, delete on public.wearable_readings to anon, authenticated;
drop policy if exists wear_read   on public.wearable_readings;
drop policy if exists wear_insert on public.wearable_readings;
drop policy if exists wear_update on public.wearable_readings;
drop policy if exists wear_delete on public.wearable_readings;
create policy wear_read   on public.wearable_readings for select to anon, authenticated using (true);
create policy wear_insert on public.wearable_readings for insert to anon, authenticated with check (true);
create policy wear_update on public.wearable_readings for update to anon, authenticated using (true) with check (true);
create policy wear_delete on public.wearable_readings for delete to anon, authenticated using (true);

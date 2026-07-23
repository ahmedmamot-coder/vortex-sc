-- ============================================================================
--  VORTEX SC — wellness_checkins : a quick daily "how do you feel" from each
--  swimmer/parent (sleep, energy, soreness, mood, hydration on a 1–5 scale).
--  Pairs with recovery data. One row per swimmer per day. Safe to re-run.
--  Paste into Supabase -> SQL Editor -> Run.
-- ============================================================================
create table if not exists public.wellness_checkins (
  id         text primary key,          -- swId + '_' + date
  sw_id      text,
  date       text,                      -- yyyy-mm-dd
  sleep      int,                        -- 1 (poor) .. 5 (great)
  energy     int,                        -- 1 .. 5
  soreness   int,                        -- 1 (none) .. 5 (very sore)
  mood       int,                        -- 1 .. 5
  hydration  int,                        -- 1 .. 5
  note       text,
  ts         bigint,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists wellness_sw_idx   on public.wellness_checkins (sw_id);
create index if not exists wellness_date_idx on public.wellness_checkins (date desc);
alter table public.wellness_checkins enable row level security;
grant select, insert, update, delete on public.wellness_checkins to anon, authenticated;
drop policy if exists well_read   on public.wellness_checkins;
drop policy if exists well_insert on public.wellness_checkins;
drop policy if exists well_update on public.wellness_checkins;
drop policy if exists well_delete on public.wellness_checkins;
create policy well_read   on public.wellness_checkins for select to anon, authenticated using (true);
create policy well_insert on public.wellness_checkins for insert to anon, authenticated with check (true);
create policy well_update on public.wellness_checkins for update to anon, authenticated using (true) with check (true);
create policy well_delete on public.wellness_checkins for delete to anon, authenticated using (true);

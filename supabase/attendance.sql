-- ============================================================================
--  VORTEX SC — attendance : one row per swimmer per day (per squad).
--  Replaces the single shared blob so concurrent coaches/devices never
--  overwrite each other's marks. Sign-in-only (matches the lockdown tier).
--  Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
-- ============================================================================
create table if not exists public.attendance (
  id         text primary key,          -- squadId + '_' + date + '_' + swId
  squad_id   text,
  date       text,                      -- yyyy-mm-dd
  sw_id      text,
  status     text,                      -- 'present' | 'absent' | 'late'
  ts         bigint,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists attendance_sq_date_idx on public.attendance (squad_id, date);
create index if not exists attendance_date_idx     on public.attendance (date desc);
alter table public.attendance enable row level security;
grant select, insert, update, delete on public.attendance to anon, authenticated;
-- Match the lockdown: signed-in users only (no anonymous access).
drop policy if exists att_lk_select on public.attendance;
drop policy if exists att_lk_insert on public.attendance;
drop policy if exists att_lk_update on public.attendance;
drop policy if exists att_lk_delete on public.attendance;
create policy att_lk_select on public.attendance for select to authenticated using (true);
create policy att_lk_insert on public.attendance for insert to authenticated with check (true);
create policy att_lk_update on public.attendance for update to authenticated using (true) with check (true);
create policy att_lk_delete on public.attendance for delete to authenticated using (true);

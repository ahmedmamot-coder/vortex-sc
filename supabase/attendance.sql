-- ============================================================================
--  VORTEX SC — attendance_marks : one row per swimmer per day (per squad).
--  Replaces the single shared blob so concurrent coaches/devices never
--  overwrite each other's marks. Sign-in-only (matches the lockdown tier).
--  (Uses a fresh table name to avoid any pre-existing "attendance" table.)
--  Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
-- ============================================================================
create table if not exists public.attendance_marks (
  id         text primary key,          -- squadId + '_' + date + '_' + swId
  squad_id   text,
  day        text,                       -- yyyy-mm-dd
  sw_id      text,
  status     text,                       -- 'present' | 'absent' | 'late'
  ts         bigint,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists attmarks_sq_day_idx on public.attendance_marks (squad_id, day);
create index if not exists attmarks_day_idx     on public.attendance_marks (day desc);
alter table public.attendance_marks enable row level security;
grant select, insert, update, delete on public.attendance_marks to anon, authenticated;
drop policy if exists attm_lk_select on public.attendance_marks;
drop policy if exists attm_lk_insert on public.attendance_marks;
drop policy if exists attm_lk_update on public.attendance_marks;
drop policy if exists attm_lk_delete on public.attendance_marks;
create policy attm_lk_select on public.attendance_marks for select to authenticated using (true);
create policy attm_lk_insert on public.attendance_marks for insert to authenticated with check (true);
create policy attm_lk_update on public.attendance_marks for update to authenticated using (true) with check (true);
create policy attm_lk_delete on public.attendance_marks for delete to authenticated using (true);

-- Enable live (realtime) push so other devices update the instant a mark changes.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='attendance_marks') then
    execute 'alter publication supabase_realtime add table public.attendance_marks';
  end if;
end $$;

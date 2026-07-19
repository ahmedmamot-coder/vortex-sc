-- ============================================================================
--  VORTEX SC — announcements : staff-sent notes shown in everyone's in-app
--  Notifications feed (and pushed). Editable after sending. Safe to re-run.
--  Paste into Supabase -> SQL Editor -> Run.
-- ============================================================================
create table if not exists public.announcements (
  id         text primary key,
  audience   text,                 -- 'all' | 'family' | 'staff'
  title      text,
  body       text,
  sender     text,
  ts         bigint,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists announcements_ts_idx on public.announcements (ts desc);
alter table public.announcements enable row level security;
grant select, insert, update, delete on public.announcements to anon, authenticated;
drop policy if exists ann_read   on public.announcements;
drop policy if exists ann_insert on public.announcements;
drop policy if exists ann_update on public.announcements;
drop policy if exists ann_delete on public.announcements;
create policy ann_read   on public.announcements for select to anon, authenticated using (true);
create policy ann_insert on public.announcements for insert to anon, authenticated with check (true);
create policy ann_update on public.announcements for update to anon, authenticated using (true) with check (true);
create policy ann_delete on public.announcements for delete to anon, authenticated using (true);

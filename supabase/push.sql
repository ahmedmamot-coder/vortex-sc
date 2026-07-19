-- ============================================================================
--  VORTEX SC — push_subscriptions : one row per device that opted in to
--  push notifications. Safe to re-run.  Paste into Supabase -> SQL Editor -> Run.
-- ============================================================================
create table if not exists public.push_subscriptions (
  id          text primary key,      -- the push endpoint (unique per device)
  endpoint    text,
  p256dh      text,
  auth        text,
  role        text,                  -- 'family' | 'staff' | coach role
  account     text,                  -- 'fam:<id>' or staff id
  swimmer_ids jsonb,                 -- swimmers this device should be notified about
  ts          bigint,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_role_idx on public.push_subscriptions (role);
alter table public.push_subscriptions enable row level security;
grant select, insert, update, delete on public.push_subscriptions to anon, authenticated;
drop policy if exists push_read   on public.push_subscriptions;
drop policy if exists push_insert on public.push_subscriptions;
drop policy if exists push_update on public.push_subscriptions;
drop policy if exists push_delete on public.push_subscriptions;
create policy push_read   on public.push_subscriptions for select to anon, authenticated using (true);
create policy push_insert on public.push_subscriptions for insert to anon, authenticated with check (true);
create policy push_update on public.push_subscriptions for update to anon, authenticated using (true) with check (true);
create policy push_delete on public.push_subscriptions for delete to anon, authenticated using (true);

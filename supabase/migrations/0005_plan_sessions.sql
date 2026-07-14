-- Saved training-log sessions: one row per saved plan (like the Lounge chat),
-- so saves from different devices never overwrite each other.

create table if not exists public.plan_sessions (
  id         text primary key,
  squad_id   text,
  title      text,
  zone       text,
  total_m    integer,
  plan       jsonb,
  sday       text,          -- saved date (YYYY-MM-DD)
  ts         bigint,
  created_at timestamptz not null default now()
);

create index if not exists plan_sessions_squad_ts_idx on public.plan_sessions (squad_id, ts desc);

alter table public.plan_sessions enable row level security;

grant select, insert, delete on public.plan_sessions to anon, authenticated;

drop policy if exists plan_sessions_read   on public.plan_sessions;
drop policy if exists plan_sessions_insert on public.plan_sessions;
drop policy if exists plan_sessions_delete on public.plan_sessions;

create policy plan_sessions_read   on public.plan_sessions for select to anon, authenticated using (true);
create policy plan_sessions_insert on public.plan_sessions for insert to anon, authenticated with check (true);
create policy plan_sessions_delete on public.plan_sessions for delete to anon, authenticated using (true);

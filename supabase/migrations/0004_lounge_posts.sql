-- Real chat backend for the Vortex Lounge: one row per message (append-only),
-- so posts from different devices can never overwrite each other.

create table if not exists public.lounge_posts (
  id         text primary key,
  author     text,
  role       text,
  initials   text,
  photo      text,
  tag        text,
  body       text,
  image      text,
  ts         bigint,
  created_at timestamptz not null default now()
);

create index if not exists lounge_posts_ts_idx on public.lounge_posts (ts desc);

alter table public.lounge_posts enable row level security;

-- The app uses the public anon key from the browser, so anon needs read + insert.
grant select, insert on public.lounge_posts to anon, authenticated;

drop policy if exists lounge_read   on public.lounge_posts;
drop policy if exists lounge_insert on public.lounge_posts;

create policy lounge_read
  on public.lounge_posts for select
  to anon, authenticated
  using (true);

create policy lounge_insert
  on public.lounge_posts for insert
  to anon, authenticated
  with check (true);

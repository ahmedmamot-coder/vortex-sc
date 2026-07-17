-- ============================================================================
--  VORTEX SC — RUN EVERYTHING (safe to run as many times as you like)
--  Paste this whole file into Supabase → SQL Editor → Run.
--  Every statement is idempotent (create-if-not-exists / drop-then-create).
-- ============================================================================

-- ---- 1) club_state : shared key/value store the app syncs into --------------
create table if not exists public.club_state (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.club_state enable row level security;
grant select, insert, update, delete on public.club_state to anon, authenticated;
drop policy if exists club_state_read   on public.club_state;
drop policy if exists club_state_write  on public.club_state;
drop policy if exists club_state_update on public.club_state;
create policy club_state_read   on public.club_state for select to anon, authenticated using (true);
create policy club_state_write  on public.club_state for insert to anon, authenticated with check (true);
create policy club_state_update on public.club_state for update to anon, authenticated using (true) with check (true);

-- ---- 2) lounge_posts : one row per Lounge message ---------------------------
create table if not exists public.lounge_posts (
  id         text primary key,
  author     text, role text, initials text, photo text,
  tag        text, body text, image text,
  ts         bigint,
  created_at timestamptz not null default now()
);
-- new columns for private manager requests (safe if they already exist)
alter table public.lounge_posts add column if not exists to_id   text;
alter table public.lounge_posts add column if not exists to_name text;
alter table public.lounge_posts add column if not exists kind    text;
create index if not exists lounge_posts_ts_idx on public.lounge_posts (ts desc);
alter table public.lounge_posts enable row level security;
-- NOTE: update is required so coaches can EDIT their own posts (upsert).
grant select, insert, update on public.lounge_posts to anon, authenticated;
drop policy if exists lounge_read   on public.lounge_posts;
drop policy if exists lounge_insert on public.lounge_posts;
drop policy if exists lounge_update on public.lounge_posts;
create policy lounge_read   on public.lounge_posts for select to anon, authenticated using (true);
create policy lounge_insert on public.lounge_posts for insert to anon, authenticated with check (true);
create policy lounge_update on public.lounge_posts for update to anon, authenticated using (true) with check (true);

-- ---- 3) lounge_comments : threaded replies on posts -------------------------
create table if not exists public.lounge_comments (
  id text primary key, post_id text,
  author text, role text, initials text, photo text, body text,
  ts bigint, created_at timestamptz not null default now()
);
create index if not exists lounge_comments_post_idx on public.lounge_comments (post_id);
alter table public.lounge_comments enable row level security;
grant select, insert on public.lounge_comments to anon, authenticated;
drop policy if exists lounge_comments_read   on public.lounge_comments;
drop policy if exists lounge_comments_insert on public.lounge_comments;
create policy lounge_comments_read   on public.lounge_comments for select to anon, authenticated using (true);
create policy lounge_comments_insert on public.lounge_comments for insert to anon, authenticated with check (true);

-- ---- 4) plan_sessions : saved swim training-log sessions --------------------
create table if not exists public.plan_sessions (
  id text primary key, squad_id text, title text, zone text,
  total_m integer, plan jsonb, sday text, ts bigint,
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

-- ---- 5) fitness_sessions : saved dryland sessions (calendar) ----------------
create table if not exists public.fitness_sessions (
  id text primary key, squad_id text, title text,
  total_exs integer, plan jsonb, sday text, ts bigint,
  created_at timestamptz not null default now()
);
create index if not exists fitness_sessions_squad_idx on public.fitness_sessions (squad_id);
alter table public.fitness_sessions enable row level security;
grant select, insert, delete on public.fitness_sessions to anon, authenticated;
drop policy if exists fitness_sessions_read   on public.fitness_sessions;
drop policy if exists fitness_sessions_insert on public.fitness_sessions;
drop policy if exists fitness_sessions_delete on public.fitness_sessions;
create policy fitness_sessions_read   on public.fitness_sessions for select to anon, authenticated using (true);
create policy fitness_sessions_insert on public.fitness_sessions for insert to anon, authenticated with check (true);
create policy fitness_sessions_delete on public.fitness_sessions for delete to anon, authenticated using (true);

-- ---- 5b) fitness_plans : each squad's editable dryland plan (one row/squad) --
create table if not exists public.fitness_plans (
  id         text primary key,   -- squad id
  plan       jsonb,
  ts         bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.fitness_plans enable row level security;
grant select, insert, update, delete on public.fitness_plans to anon, authenticated;
drop policy if exists fitness_plans_read   on public.fitness_plans;
drop policy if exists fitness_plans_insert on public.fitness_plans;
drop policy if exists fitness_plans_update on public.fitness_plans;
create policy fitness_plans_read   on public.fitness_plans for select to anon, authenticated using (true);
create policy fitness_plans_insert on public.fitness_plans for insert to anon, authenticated with check (true);
create policy fitness_plans_update on public.fitness_plans for update to anon, authenticated using (true) with check (true);

-- ---- 6) staff_accounts ------------------------------------------------------
create table if not exists public.staff_accounts (
  id text primary key, name text, username text, pin text, role text,
  squad_id text, phone text, email text, bio text, photo text,
  is_custom boolean default false, ts bigint,
  created_at timestamptz not null default now()
);
alter table public.staff_accounts enable row level security;
grant select, insert, update, delete on public.staff_accounts to anon, authenticated;
drop policy if exists staff_accounts_read   on public.staff_accounts;
drop policy if exists staff_accounts_insert on public.staff_accounts;
drop policy if exists staff_accounts_update on public.staff_accounts;
drop policy if exists staff_accounts_delete on public.staff_accounts;
create policy staff_accounts_read   on public.staff_accounts for select to anon, authenticated using (true);
create policy staff_accounts_insert on public.staff_accounts for insert to anon, authenticated with check (true);
create policy staff_accounts_update on public.staff_accounts for update to anon, authenticated using (true) with check (true);
create policy staff_accounts_delete on public.staff_accounts for delete to anon, authenticated using (true);

-- ---- 7) family_accounts : parent / swimmer logins --------------------------
create table if not exists public.family_accounts (
  id text primary key, name text, email text, phone text, pass text,
  role text, swimmer_ids jsonb, ts bigint,
  created_at timestamptz not null default now()
);
create index if not exists family_accounts_email_idx on public.family_accounts (email);
alter table public.family_accounts enable row level security;
grant select, insert, update, delete on public.family_accounts to anon, authenticated;
drop policy if exists family_accounts_read   on public.family_accounts;
drop policy if exists family_accounts_insert on public.family_accounts;
drop policy if exists family_accounts_update on public.family_accounts;
create policy family_accounts_read   on public.family_accounts for select to anon, authenticated using (true);
create policy family_accounts_insert on public.family_accounts for insert to anon, authenticated with check (true);
create policy family_accounts_update on public.family_accounts for update to anon, authenticated using (true) with check (true);

-- ---- 8) family_messages : private staff <-> family thread ------------------
create table if not exists public.family_messages (
  id text primary key, swimmer_id text, sender text,
  from_name text, from_photo text, body text, set_text text, video text,
  ts bigint, created_at timestamptz not null default now()
);
create index if not exists family_messages_sw_idx on public.family_messages (swimmer_id);
alter table public.family_messages enable row level security;
grant select, insert on public.family_messages to anon, authenticated;
drop policy if exists family_messages_read   on public.family_messages;
drop policy if exists family_messages_insert on public.family_messages;
create policy family_messages_read   on public.family_messages for select to anon, authenticated using (true);
create policy family_messages_insert on public.family_messages for insert to anon, authenticated with check (true);

-- ---- 8b) signup_alerts : admin gets every new family sign-up ---------------
create table if not exists public.signup_alerts (
  id text primary key, icon text, title text, body text,
  ts bigint, created_at timestamptz not null default now()
);
create index if not exists signup_alerts_ts_idx on public.signup_alerts (ts desc);
alter table public.signup_alerts enable row level security;
grant select, insert on public.signup_alerts to anon, authenticated;
drop policy if exists signup_alerts_read   on public.signup_alerts;
drop policy if exists signup_alerts_insert on public.signup_alerts;
create policy signup_alerts_read   on public.signup_alerts for select to anon, authenticated using (true);
create policy signup_alerts_insert on public.signup_alerts for insert to anon, authenticated with check (true);

-- ---- 9) squad_plans : live per-squad training plan -------------------------
create table if not exists public.squad_plans (
  id text primary key, plan jsonb, ts bigint,
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

-- ---- 10) season_plans : per-squad periodization ----------------------------
create table if not exists public.season_plans (
  id text primary key, season jsonb, ts bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.season_plans enable row level security;
grant select, insert, update, delete on public.season_plans to anon, authenticated;
drop policy if exists season_plans_read   on public.season_plans;
drop policy if exists season_plans_insert on public.season_plans;
drop policy if exists season_plans_update on public.season_plans;
create policy season_plans_read   on public.season_plans for select to anon, authenticated using (true);
create policy season_plans_insert on public.season_plans for insert to anon, authenticated with check (true);
create policy season_plans_update on public.season_plans for update to anon, authenticated using (true) with check (true);

-- ---- 11) Storage bucket for fitness photos & videos ------------------------
insert into storage.buckets (id, name, public)
values ('vx-media', 'vx-media', true)
on conflict (id) do update set public = true;
drop policy if exists "vx-media read"   on storage.objects;
drop policy if exists "vx-media insert" on storage.objects;
drop policy if exists "vx-media update" on storage.objects;
create policy "vx-media read"   on storage.objects for select to anon, authenticated using (bucket_id = 'vx-media');
create policy "vx-media insert" on storage.objects for insert to anon, authenticated with check (bucket_id = 'vx-media');
create policy "vx-media update" on storage.objects for update to anon, authenticated using (bucket_id = 'vx-media') with check (bucket_id = 'vx-media');

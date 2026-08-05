-- ============================================================================
--  VORTEX SC — EVERYTHING STILL PENDING, IN ONE FILE.
--  Run this once in Supabase -> SQL Editor -> Run. Safe to re-run any time.
--
--  It creates:
--    1. wellness_checkins   — daily "how do you feel" check-ins
--    2. hr_sets             — manually logged training heart-rate per set
--    3. vx-backups bucket   — private storage for the nightly backup snapshots
--    4. realtime            — live push so every device updates instantly
--
--  IMPORTANT: the new tables are created with SIGNED-IN-ONLY policies, matching
--  the security lockdown you already ran. (The older standalone files granted
--  anonymous access, which would have quietly punched a hole in that lockdown.)
-- ============================================================================

-- ---------------------------------------------------------------- 1. wellness
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

-- ----------------------------------------------------------------- 2. hr sets
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

-- ------------------------------------- lockdown-consistent policies for both
do $$
declare
  t text; p text;
  tabs text[] := array['wellness_checkins','hr_sets'];
begin
  foreach t in array tabs loop
    if to_regclass('public.'||t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
    -- clear anything permissive that an older file may have created
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
    -- signed-in only, exactly like the other post-login tables
    execute format('create policy lk_select on public.%I for select to authenticated using (true)', t);
    execute format('create policy lk_insert on public.%I for insert to authenticated with check (true)', t);
    execute format('create policy lk_update on public.%I for update to authenticated using (true) with check (true)', t);
    execute format('create policy lk_delete on public.%I for delete to authenticated using (true)', t);
  end loop;
end $$;

-- ------------------------------------------------------- 3. backups bucket
insert into storage.buckets (id, name, public)
values ('vx-backups', 'vx-backups', false)
on conflict (id) do nothing;

-- ------------------------------------------------- 4. realtime (live push)
do $$
declare
  t text;
  tabs text[] := array[
    'club_state','attendance_marks',
    'plan_sessions','fitness_sessions','squad_plans','season_plans','fitness_plans',
    'family_messages','announcements','signup_alerts','lounge_posts','lounge_comments',
    'swimmer_docs','wearable_readings','hr_sets','wellness_checkins',
    'family_accounts','staff_accounts'
  ];
begin
  foreach t in array tabs loop
    if to_regclass('public.'||t) is null then continue; end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------ check it
-- Tables that now exist:
--   select table_name from information_schema.tables
--   where table_schema='public' and table_name in ('wellness_checkins','hr_sets');
-- Tables pushing live updates:
--   select tablename from pg_publication_tables
--   where pubname='supabase_realtime' and schemaname='public' order by tablename;

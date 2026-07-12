-- Vortex Swimming Club — initial schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).

create extension if not exists "pgcrypto";

-- ============================================================
-- Enums
-- ============================================================
create type user_role as enum ('admin', 'head_coach', 'coach', 'fitness_coach', 'parent', 'swimmer');
create type course_type as enum ('L', 'S'); -- Long course (LCM) / Short course (SCM)
create type meet_status as enum ('upcoming', 'entries_open', 'in_progress', 'completed');
create type promotion_status as enum ('suggested', 'approved', 'rejected');
create type video_kind as enum ('youtube', 'vimeo', 'mp4');

-- ============================================================
-- Club (single row today; kept as a table for white-label settings)
-- ============================================================
create table club (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Vortex Swimming Club',
  zone_method text not null default '6', -- '5' or '6' zone ruleset
  locale text not null default 'en',
  rtl boolean not null default false,
  currency text not null default 'QAR',
  created_at timestamptz not null default now()
);

-- ============================================================
-- Profiles (staff accounts) — one row per auth.users row for staff
-- ============================================================
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role user_role not null,
  full_name text not null,
  squad_id uuid, -- set below via alter (fk added after squads exists)
  created_at timestamptz not null default now()
);

-- ============================================================
-- Squads
-- ============================================================
create table squads (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique, -- preteam, advb, adva, junior, seniorb, seniora, vortexb, vortexa, legend
  name text not null,
  age_range text not null,
  coach_name text not null,
  assistant_coach_name text,
  accent_color text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table profiles
  add constraint profiles_squad_id_fkey foreign key (squad_id) references squads (id) on delete set null;

-- ============================================================
-- Swimmers
-- ============================================================
create table swimmers (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references squads (id) on delete restrict,
  first_name text not null,
  last_name text not null,
  age int not null,
  gender text not null check (gender in ('Girls', 'Boys')),
  photo_url text,
  sponsor boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index swimmers_squad_id_idx on swimmers (squad_id);

create table personal_bests (
  id uuid primary key default gen_random_uuid(),
  swimmer_id uuid not null references swimmers (id) on delete cascade,
  event text not null, -- e.g. "50 Free"
  course course_type not null default 'L',
  seconds numeric not null,
  time_text text not null,
  drop_text text default '',
  achieved_at date,
  created_at timestamptz not null default now(),
  unique (swimmer_id, event, course)
);
create index personal_bests_swimmer_id_idx on personal_bests (swimmer_id);

-- ============================================================
-- Meets & results
-- ============================================================
create table meets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  meet_date date not null,
  course course_type not null default 'L',
  status meet_status not null default 'completed',
  created_at timestamptz not null default now()
);

create table meet_results (
  id uuid primary key default gen_random_uuid(),
  meet_id uuid not null references meets (id) on delete cascade,
  swimmer_id uuid not null references swimmers (id) on delete cascade,
  event text not null,
  course course_type not null default 'L',
  seconds numeric,
  time_text text not null, -- may be "NS" / "DQ"
  place int,
  created_at timestamptz not null default now()
);
create index meet_results_swimmer_id_idx on meet_results (swimmer_id);
create index meet_results_meet_id_idx on meet_results (meet_id);

create table meet_entries (
  id uuid primary key default gen_random_uuid(),
  meet_id uuid not null references meets (id) on delete cascade,
  squad_id uuid not null references squads (id) on delete cascade,
  swimmer_id uuid not null references swimmers (id) on delete cascade,
  event text not null,
  heat int,
  lane int,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Plans (session plan builder, one live plan per squad)
-- ============================================================
create table plans (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references squads (id) on delete cascade,
  title text not null default 'Session',
  zone text not null default 'EN2', -- EN1..SP3
  total_metres int not null default 0,
  updated_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table plan_sections (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans (id) on delete cascade,
  name text not null, -- Warm-up, Pre-set, Main set, Cool-down, or custom
  sort_order int not null default 0
);

create table plan_sets (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references plan_sections (id) on delete cascade,
  distance int not null default 0,
  description text not null default '',
  equipment text[] not null default '{}',
  set_types text[] not null default '{}', -- Swim, Drill, Kick, Pull, Scull
  rest text default '',
  zone text, -- overrides plan.zone when set
  sort_order int not null default 0
);

-- ============================================================
-- Attendance
-- ============================================================
create table attendance (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references squads (id) on delete cascade,
  swimmer_id uuid not null references swimmers (id) on delete cascade,
  session_date date not null,
  present boolean not null default true,
  created_at timestamptz not null default now(),
  unique (swimmer_id, session_date)
);
create index attendance_squad_date_idx on attendance (squad_id, session_date);

-- ============================================================
-- Family (parent / swimmer) accounts
-- ============================================================
create table family_accounts (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('parent', 'swimmer')),
  full_name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create table family_links (
  id uuid primary key default gen_random_uuid(),
  family_account_id uuid not null references family_accounts (id) on delete cascade,
  swimmer_id uuid not null references swimmers (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (family_account_id, swimmer_id)
);

-- ============================================================
-- T-Pace tests
-- ============================================================
create table t_pace_tests (
  id uuid primary key default gen_random_uuid(),
  swimmer_id uuid not null references swimmers (id) on delete cascade,
  distance int not null, -- 400 or 1000
  time_seconds numeric not null,
  t_pace_seconds numeric not null, -- per 100
  tested_at date not null default current_date,
  retest_due date,
  created_at timestamptz not null default now()
);

-- ============================================================
-- InBody scans
-- ============================================================
create table inbody_scans (
  id uuid primary key default gen_random_uuid(),
  swimmer_id uuid not null references swimmers (id) on delete cascade,
  scanned_at date not null default current_date,
  weight_kg numeric,
  muscle_mass_kg numeric,
  body_fat_pct numeric,
  bmr int,
  visceral_fat numeric,
  source text, -- 'pdf' | 'qr' | 'manual'
  created_at timestamptz not null default now()
);

-- ============================================================
-- Fitness (dryland) plans — stored as structured jsonb per squad
-- ============================================================
create table fitness_plans (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references squads (id) on delete cascade unique,
  sections jsonb not null default '[]', -- [{name, exercises:[{name,sets,reps,rest}]}]
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Videos
-- ============================================================
create table videos (
  id uuid primary key default gen_random_uuid(),
  swimmer_id uuid references swimmers (id) on delete cascade,
  squad_id uuid references squads (id) on delete cascade,
  title text not null,
  url text not null,
  kind video_kind not null,
  race_type text, -- 50/100/200/400/800/1500
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create table video_splits (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references videos (id) on delete cascade,
  label text not null, -- Reaction, 15m, Breakout, 25m, 35m, 45m, 50m...
  seconds numeric not null,
  sort_order int not null default 0
);

create table video_notes (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references videos (id) on delete cascade,
  timestamp_seconds numeric not null,
  note text not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Promotion engine
-- ============================================================
create table promotions (
  id uuid primary key default gen_random_uuid(),
  swimmer_id uuid not null references swimmers (id) on delete cascade,
  from_squad_id uuid not null references squads (id),
  to_squad_id uuid not null references squads (id),
  status promotion_status not null default 'suggested',
  reason text,
  suggested_by uuid references profiles (id),
  approved_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- ============================================================
-- Academy (trials / fees)
-- ============================================================
create table academy_trials (
  id uuid primary key default gen_random_uuid(),
  child_name text not null,
  age int,
  phone text,
  status text not null default 'pending', -- pending, trialled, enrolled, declined
  notes text,
  created_at timestamptz not null default now()
);

create table academy_fees (
  id uuid primary key default gen_random_uuid(),
  program_name text not null,
  price numeric not null,
  currency text not null default 'QAR',
  sort_order int not null default 0
);

-- ============================================================
-- Helper functions for RLS
-- ============================================================
create or replace function is_staff()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and role in ('admin', 'head_coach', 'coach', 'fitness_coach')
  );
$$;

create or replace function is_admin_or_head()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and role in ('admin', 'head_coach')
  );
$$;

create or replace function linked_swimmer_ids()
returns setof uuid language sql stable security definer as $$
  select swimmer_id from family_links where family_account_id = auth.uid();
$$;

-- ============================================================
-- Row Level Security
-- ============================================================
alter table club enable row level security;
alter table profiles enable row level security;
alter table squads enable row level security;
alter table swimmers enable row level security;
alter table personal_bests enable row level security;
alter table meets enable row level security;
alter table meet_results enable row level security;
alter table meet_entries enable row level security;
alter table plans enable row level security;
alter table plan_sections enable row level security;
alter table plan_sets enable row level security;
alter table attendance enable row level security;
alter table family_accounts enable row level security;
alter table family_links enable row level security;
alter table t_pace_tests enable row level security;
alter table inbody_scans enable row level security;
alter table fitness_plans enable row level security;
alter table videos enable row level security;
alter table video_splits enable row level security;
alter table video_notes enable row level security;
alter table promotions enable row level security;
alter table academy_trials enable row level security;
alter table academy_fees enable row level security;

-- Club settings: staff can read; only admin/head can update.
create policy club_select on club for select using (is_staff());
create policy club_update on club for update using (is_admin_or_head());

-- Profiles: staff can read all profiles; users can read/update their own.
create policy profiles_select_self on profiles for select using (id = auth.uid() or is_staff());
create policy profiles_update_self on profiles for update using (id = auth.uid() or is_admin_or_head());
create policy profiles_insert_admin on profiles for insert with check (is_admin_or_head());

-- Squads: staff read all; family can read squads their linked swimmer belongs to.
create policy squads_select on squads for select using (
  is_staff() or id in (select squad_id from swimmers where id in (select linked_swimmer_ids()))
);
create policy squads_write on squads for all using (is_admin_or_head()) with check (is_admin_or_head());

-- Swimmers: staff full read; family read-only their linked swimmers.
create policy swimmers_select on swimmers for select using (
  is_staff() or id in (select linked_swimmer_ids())
);
create policy swimmers_write on swimmers for insert with check (is_staff());
create policy swimmers_update on swimmers for update using (is_staff());
create policy swimmers_delete on swimmers for delete using (is_staff());

-- Personal bests / results / attendance: staff full; family read-only for their linked swimmers.
create policy pb_select on personal_bests for select using (
  is_staff() or swimmer_id in (select linked_swimmer_ids())
);
create policy pb_write on personal_bests for all using (is_staff()) with check (is_staff());

create policy meets_select on meets for select using (true);
create policy meets_write on meets for all using (is_staff()) with check (is_staff());

create policy meet_results_select on meet_results for select using (
  is_staff() or swimmer_id in (select linked_swimmer_ids())
);
create policy meet_results_write on meet_results for all using (is_staff()) with check (is_staff());

create policy meet_entries_select on meet_entries for select using (is_staff());
create policy meet_entries_write on meet_entries for all using (is_staff()) with check (is_staff());

create policy plans_select on plans for select using (is_staff());
create policy plans_write on plans for all using (is_staff()) with check (is_staff());
create policy plan_sections_select on plan_sections for select using (is_staff());
create policy plan_sections_write on plan_sections for all using (is_staff()) with check (is_staff());
create policy plan_sets_select on plan_sets for select using (is_staff());
create policy plan_sets_write on plan_sets for all using (is_staff()) with check (is_staff());

create policy attendance_select on attendance for select using (
  is_staff() or swimmer_id in (select linked_swimmer_ids())
);
create policy attendance_write on attendance for all using (is_staff()) with check (is_staff());

-- Family accounts / links: users manage their own rows only.
create policy family_accounts_self on family_accounts for select using (id = auth.uid() or is_staff());
create policy family_accounts_insert on family_accounts for insert with check (id = auth.uid());
create policy family_accounts_update on family_accounts for update using (id = auth.uid());

create policy family_links_select on family_links for select using (family_account_id = auth.uid() or is_staff());
create policy family_links_insert on family_links for insert with check (family_account_id = auth.uid());
create policy family_links_delete on family_links for delete using (family_account_id = auth.uid());

create policy t_pace_select on t_pace_tests for select using (
  is_staff() or swimmer_id in (select linked_swimmer_ids())
);
create policy t_pace_write on t_pace_tests for all using (is_staff()) with check (is_staff());

create policy inbody_select on inbody_scans for select using (
  is_staff() or swimmer_id in (select linked_swimmer_ids())
);
create policy inbody_write on inbody_scans for all using (is_staff()) with check (is_staff());

create policy fitness_plans_select on fitness_plans for select using (is_staff());
create policy fitness_plans_write on fitness_plans for all using (is_staff()) with check (is_staff());

create policy videos_select on videos for select using (
  is_staff() or swimmer_id in (select linked_swimmer_ids())
);
create policy videos_write on videos for all using (is_staff()) with check (is_staff());
create policy video_splits_select on video_splits for select using (is_staff());
create policy video_splits_write on video_splits for all using (is_staff()) with check (is_staff());
create policy video_notes_select on video_notes for select using (is_staff());
create policy video_notes_write on video_notes for all using (is_staff()) with check (is_staff());

create policy promotions_select on promotions for select using (is_staff());
create policy promotions_write on promotions for all using (is_staff()) with check (is_staff());

create policy academy_trials_all on academy_trials for all using (is_staff()) with check (true);
create policy academy_fees_select on academy_fees for select using (true);
create policy academy_fees_write on academy_fees for all using (is_admin_or_head()) with check (is_admin_or_head());

insert into club (name) values ('Vortex Swimming Club');

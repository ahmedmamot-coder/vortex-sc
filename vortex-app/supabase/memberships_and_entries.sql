-- Memberships and meet declarations, one row each.
--
-- Both lived inside single JSON documents — vx_memberships holding every swimmer's package, and
-- vx_meet_entries holding every entry for every meet — cached in the browser and written back
-- whole. Changing one swimmer's package rewrote all 304 of them; adding one entry rewrote the
-- club's entire meet declarations. That is the shape that lost the InBody scans twice.
--
-- What it costs when it goes wrong is different in each case and bad in both. A membership is
-- what a family is charged, so a stale copy quietly bills the wrong amount next month. A meet
-- entry has a closing date: an entry that disappears after the deadline is a child who does not
-- swim, and nobody finds out until the heat sheets are posted.
--
-- Two coaches seeding two meets at once, or a manager setting packages while another marks fees,
-- now touch different rows.
--
-- Run this in the Supabase SQL editor.

create table if not exists memberships (
  sw_id       text primary key,
  pkg         text default '',            -- '3x' | '4x' | '6x' | ''
  fitness     boolean not null default false,
  paid        boolean not null default false,
  start_date  date,
  end_date    date,
  note        text default '',
  updated_at  timestamptz not null default now()
);

-- 0001_init.sql declares a meet_entries table keyed on uuid references to meets, squads and
-- swimmers. The app identifies all three by the roster's own text ids and never used it, so this
-- is a separate table under its own name rather than a redefinition of one already in use.
create table if not exists meet_declarations (
  id          text primary key,           -- "<meet>::<swimmerId>::<event>"
  meet        text not null,
  sw_id       text not null,
  sw_name     text default '',            -- as entered, so an export still reads right
  event       text not null,
  heat        int,
  lane        int,
  updated_at  timestamptz not null default now()
);

create index if not exists meet_declarations_meet on meet_declarations (meet);
create index if not exists meet_declarations_sw on meet_declarations (sw_id);

alter table memberships enable row level security;
alter table meet_declarations enable row level security;

-- Matches the other per-row tables for now: any signed-in user. Stage 4 (security_4_roles.sql)
-- narrows every table at once, and both of these are written to be narrowed with them — a family
-- should see their own membership and their own children's entries, which is a policy on sw_id.
drop policy if exists memberships_read on memberships;
create policy memberships_read on memberships for select to authenticated using (true);
drop policy if exists memberships_write on memberships;
create policy memberships_write on memberships for all to authenticated using (true) with check (true);

drop policy if exists meet_declarations_read on meet_declarations;
create policy meet_declarations_read on meet_declarations for select to authenticated using (true);
drop policy if exists meet_declarations_write on meet_declarations;
create policy meet_declarations_write on meet_declarations for all to authenticated using (true) with check (true);

-- The roster, one row per swimmer per squad.
--
-- Until now the whole club's roster — every edit, every added swimmer, every removal — has been
-- a single JSON document in club_state under vx_roster_edits. One document means the last device
-- to write anything replaces every other device's work, which is how this club has repeatedly
-- watched a swimmer count go backwards and dates of birth disappear.
--
-- One row per (squad, swimmer) means two coaches editing two swimmers write two different rows
-- and cannot overwrite each other.
--
-- id is squad_id::sw_id, and it is the primary key: a batch may never name one row twice, which
-- is what took whole upserts down and cost 301 dates of birth the first time this was tried.
-- A swimmer moved between squads is a removal from one squad and an addition to another — two
-- rows, both real at the same time, which is why the key carries the squad and not only the
-- swimmer.
--
-- The document is NOT dropped by this migration and is still written by the app. It is what the
-- nightly backups, "Rebuild from the saved roster" and the date-of-birth restore all read.

create table if not exists public.vx_roster (
  id         text primary key,
  squad_id   text not null,
  sw_id      text not null,
  patch      jsonb not null default '{}'::jsonb,
  deleted    boolean not null default false,
  added      boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists vx_roster_sw_idx    on public.vx_roster (sw_id);
create index if not exists vx_roster_squad_idx on public.vx_roster (squad_id);

alter table public.vx_roster enable row level security;

-- Staff only, and signed in. Unlike club_state — whose policies date from before this app had
-- accounts — there is no reason for an anonymous visitor to read or write the roster, and the
-- roster is the one table where a mistake costs the most.
drop policy if exists vx_roster_read   on public.vx_roster;
drop policy if exists vx_roster_write  on public.vx_roster;
drop policy if exists vx_roster_update on public.vx_roster;
drop policy if exists vx_roster_delete on public.vx_roster;

create policy vx_roster_read
  on public.vx_roster for select
  to authenticated
  using (true);

create policy vx_roster_write
  on public.vx_roster for insert
  to authenticated
  with check (true);

create policy vx_roster_update
  on public.vx_roster for update
  to authenticated
  using (true) with check (true);

-- Deletes happen in two ordinary places: a swimmer put back after being removed, and the
-- migration clearing the table before it writes it.
create policy vx_roster_delete
  on public.vx_roster for delete
  to authenticated
  using (true);

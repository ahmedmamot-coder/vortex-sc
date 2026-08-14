-- Squads, one row each.
--
-- They lived in club_state as a single document: the whole club's squad list in one row, so the
-- last device to change anything replaced every other device's work. That is how a set of squad
-- colours vanished overnight, and it is the same shape of fault that turned 304 swimmers back
-- into 317.
--
-- One row per squad means renaming Junior writes Junior's row. Two coaches editing two different
-- squads stop being able to overwrite each other at all — not "less often", not "with a warning",
-- but structurally.
--
-- The id is the club's own ('junior', 'seniora'), and it never changes: every register mark,
-- plan, invoice, membership, meet entry and coach's squad access is keyed to it. A rename
-- changes `name` and nothing else.
--
-- Run this in the Supabase SQL editor. Safe to re-run. The app seeds it from what the club
-- already has the first time it finds the table empty, so nothing is lost and nothing is typed
-- twice.

create table if not exists squads (
  id          text primary key,
  name        text not null,
  ages        text default '',
  accent      text default '#2733D6',
  short       text default '',
  coach       text default '',
  -- Display order. Kept as a number so moving one squad writes one row, rather than rewriting
  -- the whole list to record a new order.
  sort        int not null default 0,
  updated_at  timestamptz not null default now()
);

create index if not exists squads_sort on squads (sort);

alter table squads enable row level security;

-- Every signed-in person needs to read them: a parent's screens name the squad their child is
-- in. Only staff may change one.
drop policy if exists squads_read  on squads;
drop policy if exists squads_write on squads;

do $$
begin
  if exists (select 1 from pg_proc where proname = 'vx_is_staff') then
    create policy squads_read  on squads for select to authenticated using (true);
    create policy squads_write on squads for all to authenticated
      using (vx_is_staff()) with check (vx_is_staff());
    raise notice 'vx: squads readable by anyone signed in, writable by staff';
  else
    create policy squads_read  on squads for select to authenticated using (true);
    create policy squads_write on squads for all to authenticated using (true) with check (true);
    raise notice 'vx: squads writable by ANY signed-in user — run security_4_roles.sql to narrow it to staff';
  end if;
end $$;

notify pgrst, 'reload schema';

-- After running it, open the app once as a manager: it fills the table from the squads the club
-- already has, and every device reads from it after that. Check with:
--   select id, name, ages, accent, sort from squads order by sort;

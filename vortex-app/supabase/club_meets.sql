-- ============================================================================
--  VORTEX SC — the club's meets, one row per meet instead of two documents for
--  all of them.
--
--  WHY, precisely.
--
--  A meet's date, venue, course and status lived in club_state, in two keys:
--  vx_custom_meets (an array of every meet the club has built) and vx_meet_status
--  (a map of every meet's status). club_state is last-write-wins on the whole
--  document, so this happens, and it happened to this club on 22 August:
--
--    1. A coach corrects the Test meet to 22 August and marks it Completed.
--       Both documents go up. The database now has both.
--    2. A device that had been offline comes back and works through its queue of
--       unsent writes. That queue records the KEY, not the bytes, so each retry
--       re-reads whatever that device currently holds and sends it — its whole
--       copy of every document, including a vx_custom_meets from before the fix.
--       24 keys went up in 37 seconds, twice in six minutes.
--    3. The meet is 30 July again and back In progress. The coach is told
--       nothing: their write did save, and was then overwritten by a device that
--       had never heard of it.
--
--  Trying again cannot fix that, and trying again is exactly what the app invited
--  — the coach set the same date four times over two hours.
--
--  One row per meet removes the collision: correcting a date touches one row, and
--  a device replaying its queue can only put back the meets it actually holds
--  rather than the whole calendar. The same move already made for swimmer status,
--  attendance, squads, videos, memberships, invoices and the meet entries
--  themselves — every one of which held up on the day this did not.
--
--  Paste into Supabase -> SQL Editor -> Run. Safe to re-run. It carries the two
--  documents into the table on first run, so no device has to be the one to do it.
-- ============================================================================

create table if not exists public.club_meets (
  name        text primary key,          -- what every entry, result and cut time is filed under
  meet_date   text default '',           -- "M/D/YYYY", the shape the app has always stored
  location    text default '',
  course      text default 'LCM',
  events      jsonb not null default '[]'::jsonb,
  status      text default 'Upcoming',   -- Upcoming | Entries open | In progress | Completed
  -- Built here, rather than registered from an imported result. Only the club's own meets are
  -- editable in the app; the rest exist so their status has somewhere to live.
  club_built  boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- Keep updated_at honest: it is what decides whose copy is newer, and a client-supplied
-- timestamp is a client-supplied timestamp.
create or replace function public.club_meets_touch() returns trigger
language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end $fn$;

drop trigger if exists club_meets_touch on public.club_meets;
create trigger club_meets_touch before insert or update on public.club_meets
  for each row execute function public.club_meets_touch();

-- ---------------------------------------------------------------- carry the documents across
-- Every meet the club built, then every meet that only has a status. Re-running changes
-- nothing that is already here: the table is the truth once it holds a row.
insert into public.club_meets (name, meet_date, location, course, events, status, club_built)
select m->>'name',
       coalesce(m->>'date',''),
       coalesce(m->>'location',''),
       coalesce(m->>'course','LCM'),
       coalesce(m->'events','[]'::jsonb),
       coalesce((select value->>(m->>'name') from public.club_state where key='vx_meet_status'), 'Upcoming'),
       true
from public.club_state, jsonb_array_elements(value) as m
where key='vx_custom_meets' and coalesce(m->>'name','') <> ''
on conflict (name) do nothing;

insert into public.club_meets (name, status, club_built)
select s.key, s.value, false
from public.club_state cs, jsonb_each_text(cs.value) as s
where cs.key='vx_meet_status' and coalesce(s.key,'') <> ''
on conflict (name) do nothing;

-- ---------------------------------------------------------------- policies
do $$
declare p text;
begin
  alter table public.club_meets enable row level security;
  revoke all on public.club_meets from anon;
  grant select, insert, update, delete on public.club_meets to authenticated;

  for p in select policyname from pg_policies
           where schemaname='public' and tablename='club_meets' loop
    execute format('drop policy if exists %I on public.club_meets', p);
  end loop;

  -- Read is staff, exactly as club_state is today — a family reads the calendar through
  -- /api/family/state, which answers with the service key. Widening it here would hand every
  -- parent the club's whole meet list directly, which is not what moving a table is for.
  if to_regproc('public.vx_is_staff') is not null then
    create policy club_meets_read on public.club_meets
      for select to authenticated using (public.vx_is_staff());
  else
    create policy club_meets_read on public.club_meets
      for select to authenticated using (true);
    raise notice 'club_meets: vx_is_staff() not found — reads are open to any signed-in user. Run security_4_roles.sql, then run this file again.';
  end if;

  if to_regproc('public.staff_check') is not null then
    create policy club_meets_write on public.club_meets
      for all to authenticated using (public.staff_check()) with check (public.staff_check());
    raise notice 'club_meets: writable by staff';
  else
    -- staff_check() comes from moderation.sql. Without it, writes are closed rather than open
    -- to everybody — the failure that left vx_squads_t writable by any parent.
    create policy club_meets_write on public.club_meets
      for all to authenticated using (false) with check (false);
    raise notice 'club_meets: writes CLOSED. Run moderation.sql (it creates staff_check), then run this file again.';
  end if;
end $$;

notify pgrst, 'reload schema';

-- Check it:
--   select name, meet_date, course, status, club_built from public.club_meets order by club_built desc, name;

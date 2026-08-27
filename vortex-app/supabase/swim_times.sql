-- ============================================================================
--  VORTEX SC — the times, one row per swim.
--
--  WHY, precisely.
--
--  A swim is written into the swimmer's own record inside vx_roster_edits, and
--  vx_roster_edits is ONE document in club_state holding the whole club: every
--  swimmer, and every time any of them has ever swum. It is the only key the app
--  merges rather than replaces on a pull — which is more than the others get, and
--  still not enough. A merge resolves a swimmer two devices both changed by taking
--  one of them whole. So a tablet that loaded the roster this morning and saves any
--  swimmer this afternoon sends that swimmer's record AS IT WAS THIS MORNING. Every
--  time typed into that swimmer at the meet in between is inside the copy it wrote
--  over. Nobody is told, because from the document's point of view nothing failed.
--
--  This is not hypothetical. The club has lost the same meet's results three times.
--  The third time the only surviving copy was a printed sheet.
--
--  One row per swim removes the collision entirely: two coaches typing two lanes
--  touch two rows, and no device ever sends a time it did not just record. It is the
--  same move already made for the entries (meet_declarations), the meets
--  (club_meets), the squads (vx_squads_t) and the statuses (swimmer_status).
--
--  The roster document is still written, so nothing that reads a time has to change
--  and a device that has not run this file behaves exactly as before. What this adds
--  is a second copy that the document cannot reach: when a pull does lose a time,
--  _timesFetch finds the row still standing and puts it back into the roster.
--
--  Paste into Supabase -> SQL Editor -> Run. Safe to re-run. The app fills the table
--  from the roster on first load and keeps the two in step from then on.
-- ============================================================================

create table if not exists public.swim_times (
  -- meet::swimmer::event. A swimmer swims an event once at a meet, so that is the
  -- identity of the swim — correcting a mistyped time updates the row it belongs to
  -- rather than recording a second race that never happened.
  id           text primary key,
  meet         text not null,
  sw_id        text not null,
  sw_name      text,                     -- as the club shows them, for reading rows raw
  event        text not null,
  sec          numeric not null,         -- the time, in seconds; the only number that matters
  course       text,                     -- 'L' | 'S'
  course_label text,                     -- 'LCM' | 'SCM'
  meet_date    text,                     -- yyyy-mm-dd, the day it was SWUM
  updated_at   timestamptz not null default now()
);
create index if not exists swim_times_meet_idx on public.swim_times (meet);
create index if not exists swim_times_sw_idx   on public.swim_times (sw_id);

-- Keep updated_at honest: a client-supplied timestamp is a client-supplied timestamp.
create or replace function public.swim_times_touch() returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  return new;
end $fn$;

drop trigger if exists swim_times_touch on public.swim_times;
create trigger swim_times_touch before insert or update on public.swim_times
  for each row execute function public.swim_times_touch();

-- ---------------------------------------------------------------- policies
do $$
declare p text;
begin
  alter table public.swim_times enable row level security;
  revoke all on public.swim_times from anon;
  grant select, insert, update, delete on public.swim_times to authenticated;

  for p in select policyname from pg_policies
           where schemaname='public' and tablename='swim_times' loop
    execute format('drop policy if exists %I on public.swim_times', p);
  end loop;

  -- Families read it: the portal shows a swimmer their own races. Only staff record them.
  create policy swim_times_read on public.swim_times
    for select to authenticated using (true);

  if to_regproc('public.staff_check') is not null then
    create policy swim_times_write on public.swim_times
      for all to authenticated using (public.staff_check()) with check (public.staff_check());
    raise notice 'swim_times: readable by anyone signed in, writable by staff';
  else
    -- staff_check() comes from moderation.sql. Without it, writes are closed rather than
    -- open to everybody — the failure that left vx_squads_t writable by any parent.
    create policy swim_times_write on public.swim_times
      for all to authenticated using (false) with check (false);
    raise notice 'swim_times: writes CLOSED. Run moderation.sql (it creates staff_check), then run this file again.';
  end if;
end $$;

notify pgrst, 'reload schema';

-- Check it:
--   select meet, count(*) from public.swim_times group by meet order by 2 desc;
--   select sw_name, event, course_label, sec, meet_date
--     from public.swim_times where meet = 'Test' order by event, sec;

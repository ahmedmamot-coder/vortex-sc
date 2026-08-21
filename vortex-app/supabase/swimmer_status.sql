-- ============================================================================
--  VORTEX SC — swimmer status (active / break / sick / injured / traveling),
--  one row per swimmer instead of one blob for the whole club.
--
--  WHY, precisely.
--
--  vx_sw_status lives in club_state as a single JSON document holding every swimmer's
--  status at once, and club_state is last-write-wins: pushKey sends the whole value, and
--  applyPull takes the remote copy whenever its timestamp is newer. Only ONE key in the
--  whole app is merged rather than replaced — vx_roster_edits — and status is not it.
--
--  So this happens, and it needs no unusual timing:
--
--    1. A coach on the poolside phone sets Omar to On break. The whole document goes up.
--       The database now says Omar is on break.
--    2. Another coach, on a tablet that loaded the document before that, sets Layla to
--       Sick. Their device sends ITS whole document — the one where Omar is still active.
--    3. Omar is active again. Nobody is told. The first coach's app pulls the newer copy
--       and shows Omar back in the register.
--
--  That is "I set him to break and it did not save". The write did save. It was overwritten
--  by a device that had never heard about it, which is not something the writer can fix by
--  trying again — and trying again is exactly what the app currently invites.
--
--  One row per swimmer removes the collision: two coaches changing two swimmers touch two
--  rows. This is the same move already made for squads, videos, memberships, invoices and
--  the InBody scans, for the same reason.
--
--  Paste into Supabase -> SQL Editor -> Run. Safe to re-run. The app migrates the old blob
--  into this table on first load and then leaves the blob alone.
-- ============================================================================

create table if not exists public.swimmer_status (
  sw_id      text primary key,
  active     boolean not null default true,
  reason     text,                       -- 'inactive' | 'travel' | 'break' | 'sick' | 'injured' | 'other'
  from_day   text,                       -- yyyy-mm-dd
  to_day     text,                       -- yyyy-mm-dd, empty/null = no end date
  note       text,
  set_by     text,                       -- who changed it, as the app shows them
  ts         bigint,
  updated_at timestamptz not null default now()
);
create index if not exists swimmer_status_active_idx on public.swimmer_status (active);

-- Keep updated_at honest: it is what the app uses to decide whose copy is newer, and a
-- client-supplied timestamp is a client-supplied timestamp.
create or replace function public.swimmer_status_touch() returns trigger
language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end $fn$;

drop trigger if exists swimmer_status_touch on public.swimmer_status;
create trigger swimmer_status_touch before insert or update on public.swimmer_status
  for each row execute function public.swimmer_status_touch();

-- ---------------------------------------------------------------- policies
do $$
declare p text;
begin
  alter table public.swimmer_status enable row level security;
  revoke all on public.swimmer_status from anon;
  grant select, insert, update, delete on public.swimmer_status to authenticated;

  for p in select policyname from pg_policies
           where schemaname='public' and tablename='swimmer_status' loop
    execute format('drop policy if exists %I on public.swimmer_status', p);
  end loop;

  -- Families read it: the portal shows a swimmer's own status, and the register explains an
  -- absence with it. Only staff decide it.
  create policy swimmer_status_read on public.swimmer_status
    for select to authenticated using (true);

  if to_regproc('public.staff_check') is not null then
    create policy swimmer_status_write on public.swimmer_status
      for all to authenticated using (public.staff_check()) with check (public.staff_check());
    raise notice 'swimmer_status: readable by anyone signed in, writable by staff';
  else
    -- staff_check() comes from moderation.sql. Without it, writes are closed rather than
    -- open to everybody — the failure that left vx_squads_t writable by any parent.
    create policy swimmer_status_write on public.swimmer_status
      for all to authenticated using (false) with check (false);
    raise notice 'swimmer_status: writes CLOSED. Run moderation.sql (it creates staff_check), then run this file again.';
  end if;
end $$;

notify pgrst, 'reload schema';

-- Check it:
--   select sw_id, active, reason, from_day, to_day from public.swimmer_status order by updated_at desc limit 20;

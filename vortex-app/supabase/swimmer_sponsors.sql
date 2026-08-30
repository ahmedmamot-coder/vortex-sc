-- ============================================================================
--  VORTEX SC — sponsorship (the VIP Sponsored badge on a swimmer's profile),
--  one row per swimmer instead of one blob for the whole club.
--
--  WHY, precisely.
--
--  Sponsorship lived in vx_sponsored, a single JSON document inside club_state holding
--  every sponsored swimmer at once, and club_state is last-write-wins: pushKey sends the
--  whole value and applyPull takes the remote copy when its timestamp is newer. Only ONE
--  key in this app is merged rather than replaced — vx_roster_edits — and this was not it.
--
--  So this happens, and it needs no unusual timing:
--
--    1. A coach marks Kareem as sponsored. The whole document goes up: {kareem:true}.
--    2. Another coach, on a tablet that read the document before that, marks a different
--       swimmer. Their device sends ITS whole document — the one with no Kareem in it.
--    3. Kareem is not sponsored any more. Nobody is told. The first device keeps showing
--       the gold header until it is reloaded, because the guard that stops a stale pull
--       undoing a local edit is doing its job; then it reloads, takes the newer copy, and
--       the badge is gone.
--
--  That is "the mark as sponsor is not saving". The write did save. It was overwritten by
--  a device that had never heard about it, which is not something the coach can fix by
--  marking it again — and marking it again is exactly what the app invited.
--
--  One row per swimmer removes the collision: two coaches marking two swimmers touch two
--  rows. This is the same move already made for statuses, squads, meets, videos,
--  memberships, invoices, documents and the InBody scans, for the same reason.
--
--  Un-marking writes sponsored=false rather than deleting the row, exactly as a swimmer
--  set back to Active keeps a row in swimmer_status. It means an empty table can only be
--  a club that has not been migrated yet, never a club where nobody is sponsored — which
--  is what makes the one-time seed from the old document safe to run.
--
--  Paste into Supabase -> SQL Editor -> Run. Safe to re-run. The app fills this table from
--  the old club_state document the first time a manager opens it, and then leaves the
--  document alone.
-- ============================================================================

create table if not exists public.swimmer_sponsors (
  sw_id      text primary key,
  sponsored  boolean not null default false,
  set_by     text,                       -- who changed it, as the app shows them
  ts         bigint,
  updated_at timestamptz not null default now()
);
create index if not exists swimmer_sponsors_on_idx on public.swimmer_sponsors (sponsored);

-- Keep updated_at honest: it is what decides whose copy is newer, and a client-supplied
-- timestamp is a client-supplied timestamp.
create or replace function public.swimmer_sponsors_touch() returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  new.updated_at := now();
  return new;
end $fn$;

drop trigger if exists swimmer_sponsors_touch on public.swimmer_sponsors;
create trigger swimmer_sponsors_touch before insert or update on public.swimmer_sponsors
  for each row execute function public.swimmer_sponsors_touch();

-- ---------------------------------------------------------------- policies
do $$
declare p text;
begin
  alter table public.swimmer_sponsors enable row level security;
  revoke all on public.swimmer_sponsors from anon;
  grant select, insert, update, delete on public.swimmer_sponsors to authenticated;

  for p in select policyname from pg_policies
           where schemaname='public' and tablename='swimmer_sponsors' loop
    execute format('drop policy if exists %I on public.swimmer_sponsors', p);
  end loop;

  -- Families read it: a sponsored swimmer's own profile carries the badge in the parent
  -- portal too. Only staff decide it.
  create policy swimmer_sponsors_read on public.swimmer_sponsors
    for select to authenticated using (true);

  if to_regproc('public.staff_check') is not null then
    create policy swimmer_sponsors_write on public.swimmer_sponsors
      for all to authenticated using (public.staff_check()) with check (public.staff_check());
    raise notice 'swimmer_sponsors: readable by anyone signed in, writable by staff';
  else
    -- staff_check() comes from moderation.sql. Without it, writes are closed rather than
    -- open to everybody — the failure that left vx_squads_t writable by any parent.
    create policy swimmer_sponsors_write on public.swimmer_sponsors
      for all to authenticated using (false) with check (false);
    raise notice 'swimmer_sponsors: writes CLOSED. Run moderation.sql (it creates staff_check), then run this file again.';
  end if;
end $$;

notify pgrst, 'reload schema';

-- Check it:
--   select sw_id, sponsored, set_by, updated_at from public.swimmer_sponsors order by updated_at desc limit 20;
--
-- What the club had before the move, for comparison with what the seed wrote:
--   select value from public.club_state where key = 'vx_sponsored';

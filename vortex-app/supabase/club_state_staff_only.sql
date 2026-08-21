-- ============================================================================
--  VORTEX SC — club_state stops being readable by every parent. RUN THIS LAST.
--
--  Audit finding D3, and the last one left.
--
--  club_state's policy is `for select to authenticated using (true)`, and every device
--  pulls all 35 keys with one request. Anybody can create a family login — that is what
--  registration is — so "authenticated" is not a boundary. One registration was the
--  distance between a stranger and the club's roster, its fees, its memberships, its
--  billing and its staff overrides.
--
--  THE APP HAS TO BE ON THE NEW BUILD FIRST. A family device on the current build reads
--  club_state directly; run this before it has updated and its portal goes blank —
--  performance, meets, fees, all of it — for every family still on the old copy. This is
--  the same order-of-operations as media_private.sql, and for the same reason.
--
--  What replaces it: /api/family/state, which holds the service key, works out which
--  children are the caller's, and returns an allowlist of keys with everybody else's
--  swimmer ids removed. Staff keep reading club_state directly — they are the club.
--
--  ORDER
--    1. Deploy the app.  2. Confirm a parent's portal still works (below).  3. Run this.
-- ============================================================================

-- ---------------------------------------------------------------- 1. check first
-- On a parent account, in the app: Performance, Attendance, Results, Meets, Fees and
-- Documents must all still fill in. If any of them is empty, the slice is missing a key —
-- add it to CLUB_KEYS or PER_SWIMMER_KEYS in src/app/api/family/state/route.ts and deploy
-- again. Do not run section 2 until that screen is right.
--
-- And confirm the route is actually being used, rather than the client quietly falling
-- back: in the browser's network tab on a parent's device there should be a request to
-- /api/family/state, and no request to /rest/v1/club_state.

-- ---------------------------------------------------------------- 2. close it
do $$
begin
  if to_regproc('public.vx_is_staff') is null then
    raise exception 'vx_is_staff() does not exist - run security_4_roles.sql first, or this would close club_state to everybody including staff';
  end if;

  drop policy if exists vx_s4_read on public.club_state;
  drop policy if exists club_state_read on public.club_state;

  create policy club_state_read on public.club_state
    for select to authenticated using (public.vx_is_staff());

  raise notice 'club_state: readable by staff only. Families now read /api/family/state.';
end $$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------- 3. verify
--   select policyname, cmd, roles, qual from pg_policies
--   where schemaname='public' and tablename='club_state' and cmd='SELECT';
--
-- Then open a parent account once more. If anything went blank, roll back immediately:
--
--   drop policy if exists club_state_read on public.club_state;
--   create policy club_state_read on public.club_state
--     for select to authenticated using (true);

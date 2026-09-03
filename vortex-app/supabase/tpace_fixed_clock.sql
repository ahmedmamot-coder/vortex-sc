-- ============================================================================
--  VORTEX SC — the T30 and T20 in t_pace_tests: a trial says which test it was.
--
--  WHY, precisely.
--
--  t_pace_tests was built for the two trials that fix the DISTANCE and time it — 400 m and
--  1000 m — and its columns say so: `distance` carries 400 or 1000, `time_seconds` carries what
--  the swimmer swam it in. The T30 and T20 are measured the other way round. The clock is fixed
--  and the distance is the result, so a T30 row is distance = 1650, time_seconds = 1800.
--
--  Those columns hold that perfectly well. What they cannot do is tell the two apart:
--
--    distance 1000, time_seconds 1800  →  a 1000 m trial swum in 30:00 by a slow swimmer,
--                                         or a T30 in which the swimmer covered 1000 m?
--
--  Both are real rows a coach could enter, and they mean opposite things — the first is a
--  1000 m trial at 3:00/100, the second a T30 at 3:00/100 by coincidence and nothing else. A
--  reader guessing from `time_seconds = 1800` would label whichever it met wrongly half the
--  time, and every zone target taken off it follows the label.
--
--  So the row says which test it was. It is one column, and it is the only thing the app cannot
--  work out for itself.
--
--  `distance` also widens from int to numeric. A lap count against a 25 m pool is whole metres,
--  but half a length is 12.5 m, and an int column silently rounds that to 13 — a rounding nobody
--  asked for on the one number the coach actually measured.
--
--  Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
--
--  ORDERING. The app copes with this file not having been run yet: a 400 m or 1000 m trial still
--  saves exactly as before, and a T30 or T20 is refused with a message naming this file rather
--  than written as a row nothing could read back correctly. So deploy order does not matter, but
--  until this runs the two new tests are unavailable on the /squads/.../tools/t-pace screen.
-- ============================================================================

-- 1. Which test the row is. Nullable first, so the backfill has something to key off.
alter table t_pace_tests add column if not exists test_type text;

-- 2. Backfill. Before this file, the screen could write a 400 m trial and a 1000 m trial and
--    nothing else, so the distance identifies every existing row with nothing left to guess.
update t_pace_tests
   set test_type = case when distance = 400 then '400' else '1000' end
 where test_type is null;

-- 3. Now it can be required. A row that does not say which test it was is the ambiguity this
--    file exists to remove, so the column does not permit one.
alter table t_pace_tests alter column test_type set default '1000';
alter table t_pace_tests alter column test_type set not null;

-- 4. And only the four tests the app knows how to read. Anything else would reach the screen as
--    a trial with no label and a pace nobody could check.
alter table t_pace_tests drop constraint if exists t_pace_tests_test_type_chk;
alter table t_pace_tests
  add constraint t_pace_tests_test_type_chk
  check (test_type in ('1000', '400', 't30', 't20'));

-- 5. The measured distance, unrounded. int -> numeric is a widening, so no existing value moves.
alter table t_pace_tests alter column distance type numeric;

comment on column t_pace_tests.test_type is
  '1000 | 400 (distance trials: time is measured) | t30 | t20 (fixed clock: distance is measured)';
comment on column t_pace_tests.distance is
  'Metres. For a distance trial the test''s own distance; for a T30/T20 the distance the swimmer covered.';
comment on column t_pace_tests.time_seconds is
  'Seconds. For a distance trial the swim; for a T30/T20 the fixed clock (1800 / 1200).';

-- RLS is unchanged: t_pace_select (staff, or a family for their own linked swimmers) and
-- t_pace_write (staff only) are policies on the table and on swimmer_id, and neither reads a
-- column this file touches. Adding a column does not widen who can see a row.

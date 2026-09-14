-- Structured set fields for the plan builder.
--
-- A set is written as reps × distance with a stroke and a few focus tags, and three of those had
-- nowhere to live: "4 × 100" was stuffed into the description text because plan_sets had no reps
-- column, and stroke and focus were not stored at all. This adds the missing columns.
--
-- `add column if not exists` does nothing to a column already there, so this is safe on a
-- database that is already correct and safe to run twice. It adds no data to existing rows and
-- changes none — on Postgres 11+ a NOT NULL column with a constant default is a catalogue-only
-- change, so this does not rewrite the table.
--
-- Favourites are NOT here. The builder coaches use (public/proto.html) keeps starred sets in
-- club_state under the key 'vx_plan_favs', next to the custom Type/Stroke/Tool chips, so that
-- they are shared and merged across devices the same way. An earlier version of this file also
-- created a plan_set_favorites table for the legacy Next.js plans route; it never held a row and
-- has been dropped.

alter table public.plan_sets
  add column if not exists reps   int   not null default 1,
  add column if not exists stroke text,                              -- Free, Fly, BK, BR, IM, Choice
  add column if not exists focus  text[] not null default '{}';      -- Descend, Build, DPS, …

notify pgrst, 'reload schema';

-- --------------------------------------------------------------------------------- check it
-- The three columns the builder writes, and whether they are there. All must say ✓.
with want(col) as (values ('reps'), ('stroke'), ('focus'))
select 'plan_sets' as table_name, w.col as column_name,
       case when a.attname is null then '✗ STILL MISSING' else '✓' end as status
  from want w
  left join pg_attribute a
         on a.attrelid = to_regclass('public.plan_sets')
        and a.attname = w.col and a.attnum > 0 and not a.attisdropped
 order by (a.attname is null) desc, w.col;

-- Existing rows keep their distances and pick up the defaults: every row reps = 1, focus = {}.
select count(*)                                as rows_total,
       count(*) filter (where reps = 1)        as reps_defaulted,
       count(*) filter (where focus = '{}')    as focus_defaulted,
       sum(distance)                           as total_metres
  from public.plan_sets;

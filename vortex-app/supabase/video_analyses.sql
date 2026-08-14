-- Race video analyses, one row each.
--
-- They lived in club_state as a single document: every clip the club had ever marked, in one
-- row, so the last device to touch anything replaced everyone else's work. That is the same
-- shape that lost a set of squad colours overnight and turned 304 swimmers back into 317, and
-- three people mark videos in this app.
--
-- One row per analysis means Mary marking a Senior A writes Mary's row. Two coaches marking two
-- clips stop being able to overwrite each other at all — not "less often", not "with a warning",
-- but structurally.
--
-- The id is the clip's own, minted from the clock when it was added, and it never changes. There
-- is no composite key here: the roster migration failed because a moved swimmer produced the
-- same key twice in one batch and Postgres rejects an upsert that names one row twice, taking
-- the whole batch with it. One clip is one id, so that cannot arise.
--
-- Nothing is thrown away by running this. The app keeps writing the old document as well, and
-- reads it whenever this table is missing, so the club is never stranded between the two.
--
-- Run this in the Supabase SQL editor. Safe to re-run. The app fills it from what the club
-- already has, once, the first time a manager opens it with the table empty.

create table if not exists vx_video_analyses (
  id          text primary key,          -- the clip's own id, e.g. 'vidm2k4x1_7'
  title       text not null default '',
  tag         text default '',           -- meet name / event
  url         text not null default '',
  kind        text default 'mp4',        -- mp4 | youtube | vimeo
  vid         text default '',           -- the id inside that player, or the file URL
  race_type   text default '100',        -- 50 / 100 / 200 / 400 / 800 / 1500
  -- The marks, as captured: [{label:'Start', t:4.317}, {label:'15m', t:11.12}, …]
  laps        jsonb not null default '[]'::jsonb,
  strokes     jsonb not null default '{}'::jsonb,   -- {'25m': 9, '35m': 9}
  -- The dolphin kicks in each streamline, keyed by the mark that follows the wall: {'15m': 8}
  kicks       jsonb not null default '{}'::jsonb,
  -- One recording of a heat holds two or three lanes, all measured from the same gun:
  -- [{id, name, laps, strokes, kicks}]. Lane one is mirrored into laps/strokes/kicks above so
  -- an analysis is still readable by an app that knows nothing about lanes.
  swimmers    jsonb not null default '[]'::jsonb,
  stroke      text,                                 -- Free | Back | Breast | Fly | IM
  notes       jsonb not null default '[]'::jsonb,   -- [{t: 12.4, text: '…'}]
  breakout_m  text,                                 -- only on analyses marked the old way
  saved_at    timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists vx_video_analyses_saved on vx_video_analyses (saved_at desc);

alter table vx_video_analyses enable row level security;

drop policy if exists vx_video_read  on vx_video_analyses;
drop policy if exists vx_video_write on vx_video_analyses;

do $$
begin
  if exists (select 1 from pg_proc where proname = 'vx_is_staff') then
    -- A parent watching their child's race is reading an analysis a coach made.
    create policy vx_video_read  on vx_video_analyses for select to authenticated using (true);
    create policy vx_video_write on vx_video_analyses for all to authenticated
      using (vx_is_staff()) with check (vx_is_staff());
    raise notice 'vx: analyses readable by anyone signed in, writable by staff';
  else
    create policy vx_video_read  on vx_video_analyses for select to authenticated using (true);
    create policy vx_video_write on vx_video_analyses for all to authenticated using (true) with check (true);
    raise notice 'vx: analyses writable by ANY signed-in user — run security_4_roles.sql to narrow it to staff';
  end if;
end $$;

notify pgrst, 'reload schema';

-- After running it, open the app once as a manager: it fills the table from the analyses the
-- club already has, and every device reads from it after that. Check with:
--   select id, title, race_type, jsonb_array_length(laps) as marks, saved_at
--     from vx_video_analyses order by saved_at desc;

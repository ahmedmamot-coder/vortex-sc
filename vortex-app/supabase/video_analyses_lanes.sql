-- Race video analyses: the lanes in one recording, and the dolphin kicks.
--
-- Two things the club asked for after using the video screen for a season.
--
-- 1. A heat is one recording with eight lanes in it. Until now an analysis was one swimmer, so
--    comparing three swimmers meant marking three separate clips — and each of those was
--    measured from its own start, which is exactly the comparison that is not worth making. The
--    marks now belong to a lane inside the clip, so one recording carries two or three swimmers
--    and every one of them is measured from the same gun.
--
-- 2. The strokes were counted; the streamline was not. A swimmer who kicks eight off the block
--    and three off every turn is losing the race at the turns, and nothing on the sheet said so.
--
-- Nothing is rewritten by running this. An analysis saved before lanes existed keeps its marks
-- in laps/strokes at the top of the row and is read as a single unnamed lane; the app also
-- keeps writing lane one back to those same columns, so a device still running the older app
-- finds the swim exactly where it has always looked for it.
--
-- Run this in the Supabase SQL editor, after video_analyses.sql. Safe to re-run.

alter table vx_video_analyses
  -- The dolphin kicks in each streamline, keyed by the mark that follows the wall:
  -- {'15m': 8, 'L2 15m': 5}. Lane one's, mirroring laps and strokes above it.
  add column if not exists kicks     jsonb not null default '{}'::jsonb,
  -- The lanes, each with its own marks and counts:
  -- [{id, name, laps:[{label,t}], strokes:{}, kicks:{}}]. Empty on an analysis saved before
  -- lanes existed, which is read as one lane from laps/strokes/kicks rather than as no swim.
  add column if not exists swimmers  jsonb not null default '[]'::jsonb,
  -- Free / Back / Breast / Fly / IM. It changes what the advice on a stroke count means, and
  -- it is what the assistant is told the swim was.
  add column if not exists stroke    text;

notify pgrst, 'reload schema';

-- Check with:
--   select id, title, race_type, stroke,
--          jsonb_array_length(laps) as marks,
--          greatest(jsonb_array_length(swimmers), 1) as lanes
--     from vx_video_analyses order by saved_at desc;

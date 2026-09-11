-- Stroke counts on race splits, so the video tool can show the numbers a coach
-- actually reads back to a swimmer: stroke rate, distance-per-stroke and stroke
-- index — not just the clock.
--
-- A split has always been a label and a time (video_splits: "25m", 12.19). The
-- pro race breakdown every coach compares against — the OMEGA overlay on the
-- broadcast — turns each segment into a speed and, once you know how many strokes
-- were taken across it, into a rate and an efficiency index. That last piece is
-- one integer per split: the strokes taken in the segment that ends at this
-- marker. This adds a column to hold it.
--
-- It is nullable on purpose. A segment nobody counted strokes for still shows its
-- time and its speed; only the stroke-based numbers wait for the count. Old splits
-- read back as null and lose nothing.
--
-- Run this in the Supabase SQL editor. Safe to re-run. Until it exists the app
-- keeps saving splits without the count — the video tool detects the missing
-- column and falls back, so no club is stranded between the two.

alter table video_splits
  add column if not exists strokes int;

notify pgrst, 'reload schema';

-- Stroke Lab analyses, one row each.
--
-- Stroke Lab (Tools → Stroke Lab) tracks a swimmer's joints on a clip or the live camera and
-- works out joint angles, body line, stroke rate, velocity, distance per cycle, kicks and the
-- start/turn splits. Until this table existed the only way to keep any of it was a CSV on one
-- coach's laptop. One row is one analysis of one swimmer, saved by a coach.
--
-- What a row holds:
--   summary  the numbers a coach reads: stroke rate, cycle time, velocity, DPS, catch elbow,
--            kicks per cycle, average body line / head tilt, tracking quality, cycles counted
--   splits   the start & turn markers as tapped, {signal: 0.000, block: 0.712, …}, and the
--            splits worked out from them, [{label:'Reaction time', sec:0.71}, …]
--   frames   every tracked frame: time, quality, and each angle — the same columns as the CSV,
--            so a later chart or a comparison between two sessions needs nothing re-filmed
-- The video itself is NOT stored here: a clip is tens of megabytes, and this table is read
-- every time the history opens.
--
-- Children's movement data, so only staff can read or write it. Parents do not see it yet.
--
-- Run in the Supabase SQL editor AFTER security_4_roles.sql (it needs vx_is_staff()).
-- Safe to re-run.

create table if not exists vx_stroke_analyses (
  id            text primary key,                       -- minted by the app: 'sl' + clock + random
  swimmer_id    text,                                   -- the roster id when the name matched one
  swimmer_name  text not null default '',
  squad_name    text default '',
  session_date  date not null default current_date,
  stroke        text default 'auto',                    -- auto | free | back | breast | fly
  camera        text default 'under',                   -- under | side | front
  source        text default 'video',                   -- video | live | demo
  clip_name     text default '',
  duration_s    numeric,
  scale_mpp     numeric,                                -- metres per pixel; null = never set
  summary       jsonb not null default '{}'::jsonb,
  splits        jsonb not null default '{}'::jsonb,
  frames        jsonb not null default '[]'::jsonb,
  notes         text default '',
  saved_by      text default '',                        -- the coach's name, as the app knows it
  saved_by_email text default '',
  saved_at      timestamptz not null default now()      -- stamped by the server, never the device
);

create index if not exists vx_stroke_analyses_swimmer on vx_stroke_analyses (swimmer_id, session_date desc);
create index if not exists vx_stroke_analyses_name    on vx_stroke_analyses (lower(swimmer_name), session_date desc);
create index if not exists vx_stroke_analyses_saved   on vx_stroke_analyses (saved_at desc);

alter table vx_stroke_analyses enable row level security;

drop policy if exists vx_stroke_read  on vx_stroke_analyses;
drop policy if exists vx_stroke_write on vx_stroke_analyses;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'vx_is_staff') then
    -- Refuse rather than fall back to "anyone signed in": this is children's movement data, and
    -- a permissive policy created now would not be tightened by running security_4 later.
    raise exception 'vx: run security_4_roles.sql first — vx_is_staff() does not exist, so staff cannot be told apart from families';
  end if;
  create policy vx_stroke_read  on vx_stroke_analyses for select to authenticated using (vx_is_staff());
  create policy vx_stroke_write on vx_stroke_analyses for all    to authenticated
    using (vx_is_staff()) with check (vx_is_staff());
  raise notice 'vx: stroke analyses readable and writable by staff only';
end $$;

notify pgrst, 'reload schema';

-- Check with:
--   select swimmer_name, session_date, stroke, summary->>'sr' as stroke_rate,
--          jsonb_array_length(frames) as frames, saved_by, saved_at
--     from vx_stroke_analyses order by saved_at desc limit 20;

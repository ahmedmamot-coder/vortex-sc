-- InBody scans, one row per scan, in the database.
--
-- They used to live inside vx_sw_meta: a single JSON document holding every swimmer in the
-- club, cached in the browser and written back whole. That shape loses data, and did.
-- Saving a scan meant rewriting the entire club's record, so the newest copy was whichever
-- device last pushed the whole blob — and a phone whose storage was full would push back a
-- stale copy and destroy scans that were already safely on the server. A sheet is twenty-three
-- readings copied off a printout by hand; it must not be able to lose to a caching accident.
--
-- One row per scan cannot do that. Two coaches saving two swimmers at once touch different
-- rows, a device with no room to cache anything still writes, and nothing rewrites a record it
-- was not asked to.
--
-- 0001_init.sql declares an earlier inbody_scans table keyed on swimmers(id) as a uuid. The app
-- identifies swimmers by the roster's own text ids and never used it. This is the table the app
-- actually reads and writes; the old one is left alone.
--
-- Run this in the Supabase SQL editor.

create table if not exists inbody_readings (
  id          text primary key,           -- "<swimmerId>::<date>" — re-saving a sheet corrects it
  sw_id       text not null,
  date        date not null,
  -- The three headline figures get real columns: they are charted, sorted and compared, and
  -- the rest of the sheet is along for the ride.
  weight      numeric,
  fat         numeric,                    -- percent body fat (PBF)
  muscle      numeric,                    -- skeletal muscle mass (SMM)
  -- Everything else the sheet prints. As a document because an InBody model prints what it
  -- prints, and a new field on a newer machine should not need a migration before a coach can
  -- record it.
  vals        jsonb not null default '{}'::jsonb,
  file_url    text,                       -- the scan itself, in Storage
  file_name   text,
  updated_at  timestamptz not null default now()
);

create index if not exists inbody_readings_sw_date on inbody_readings (sw_id, date desc);

alter table inbody_readings enable row level security;

-- Matches the other per-row tables for now: any signed-in user. Stage 4 (security_4_roles.sql)
-- narrows every table at once, and this one is written to be narrowed with them — a family
-- should see their own children's scans and nobody else's, which is a policy on sw_id.
drop policy if exists inbody_readings_read on inbody_readings;
create policy inbody_readings_read on inbody_readings for select to authenticated using (true);

drop policy if exists inbody_readings_write on inbody_readings;
create policy inbody_readings_write on inbody_readings for all to authenticated using (true) with check (true);

-- Invoices, one row each, in the database.
--
-- They lived inside vx_billing: a single JSON document holding every invoice the club has ever
-- issued, cached in the browser and written back whole. That is the same shape that lost the
-- InBody scans twice — marking one family paid rewrote the entire club's billing history, so
-- the newest copy was whichever device last pushed the whole document, and a phone with no room
-- to cache it could push back a stale copy and undo payments that were already recorded.
--
-- It is worse here than it was for scans. A lost scan is retyped from a printout. A lost payment
-- is a family told they still owe money they have already handed over, and there is no printout
-- to retype it from.
--
-- One row per invoice cannot do that: marking one paid touches one row, two people working on
-- fees at once touch different rows, and nothing rewrites a record it was not asked to.
--
-- Run this in the Supabase SQL editor.

create table if not exists invoices (
  id          text primary key,           -- the app's own invoice id
  sw_id       text not null,
  sq_id       text,
  period      text not null,              -- 'YYYY-MM'
  issued      date,
  due         date,
  -- The money, as real columns: these are summed, sorted and chased, and a total that lives only
  -- inside a JSON document cannot be added up by the database.
  total       numeric not null default 0,
  status      text not null default 'unpaid',
  -- The line items, and how it was paid — shapes that vary per invoice and are only ever read
  -- back whole.
  items       jsonb not null default '[]'::jsonb,
  paid        jsonb,
  note        text default '',
  updated_at  timestamptz not null default now()
);

create index if not exists invoices_period on invoices (period desc);
create index if not exists invoices_sw on invoices (sw_id, period desc);
create index if not exists invoices_unpaid on invoices (status) where status <> 'paid';

alter table invoices enable row level security;

-- Matches the other per-row tables for now: any signed-in user. Stage 4
-- (security_4_roles.sql) narrows every table at once, and this one is written to be narrowed
-- with them — a family should see their own invoices and no one else's, which is a policy on
-- sw_id. Until that runs, a parent could read the club's whole billing history, which is the
-- strongest argument for getting Stage 4 done.
drop policy if exists invoices_read on invoices;
create policy invoices_read on invoices for select to authenticated using (true);

drop policy if exists invoices_write on invoices;
create policy invoices_write on invoices for all to authenticated using (true) with check (true);

-- ============================================================================
--  VORTEX SC — wearable_connections : stores each swimmer's WHOOP/Fitbit OAuth
--  tokens so the server can auto-pull their recovery/HR/sleep on a schedule.
--  These tokens are SENSITIVE — this table is written & read ONLY by the server
--  route (which uses the Supabase service-role key), never by the browser.
--  Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
-- ============================================================================
create table if not exists public.wearable_connections (
  sw_id          text primary key,      -- one connection per swimmer
  provider       text,                  -- 'whoop' | 'fitbit'
  access_token   text,
  refresh_token  text,
  expires_at     bigint,                -- epoch ms when the access token expires
  provider_uid   text,                  -- the band account's user id
  scope          text,
  connected_by   text,                  -- family/staff id who linked it
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
alter table public.wearable_connections enable row level security;
-- No anon/authenticated policies on purpose: the browser must NOT read these tokens.
-- The server route uses the service-role key, which bypasses RLS. Revoke any broad grants.
revoke all on public.wearable_connections from anon, authenticated;
grant  all on public.wearable_connections to service_role;

-- ============================================================================
--  VORTEX SC — private Storage bucket for automated JSON backups.
--  The daily backup route (server, service-role) writes a dated snapshot here.
--  Private: only the server (service-role key) can read/write it. Safe to re-run.
--  Paste into Supabase -> SQL Editor -> Run.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('vx-backups', 'vx-backups', false)
on conflict (id) do nothing;

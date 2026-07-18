-- ============================================================================
--  VORTEX SC — STORAGE BUCKET for documents, InBody reports, photos & video.
--  This is what makes document/InBody uploads actually save. Safe to re-run.
--  Paste into Supabase -> SQL Editor -> Run.
-- ============================================================================

-- 1) Create (or fix) the bucket, and make it readable by URL.
insert into storage.buckets (id, name, public)
values ('vx-media', 'vx-media', true)
on conflict (id) do update set public = true;

-- 2) Allow the app to read / upload / overwrite files in this bucket.
drop policy if exists "vx-media read"   on storage.objects;
drop policy if exists "vx-media insert" on storage.objects;
drop policy if exists "vx-media update" on storage.objects;
create policy "vx-media read"   on storage.objects for select to anon, authenticated using (bucket_id = 'vx-media');
create policy "vx-media insert" on storage.objects for insert to anon, authenticated with check (bucket_id = 'vx-media');
create policy "vx-media update" on storage.objects for update to anon, authenticated using (bucket_id = 'vx-media') with check (bucket_id = 'vx-media');

-- 3) Verify — this should return one row showing the bucket exists and is public.
select id, name, public from storage.buckets where id = 'vx-media';

-- Make the media bucket private. RUN THIS LAST.
--
-- vx-media holds children's birth certificates, passports, medical certificates, photographs
-- and race videos. While `public` is true, every one of those is reachable by anyone who has
-- the URL, with no sign-in at all — a public bucket serves files through an endpoint that
-- bypasses row-level security entirely. Locking the swimmer_docs table hid the index; it did
-- nothing to the documents.
--
-- ORDER MATTERS. Run this only once the app is on a build that signs its media links
-- (2026-08-10a or later — Admin → Settings → About this club names the build on the device).
-- Flip it first and every photo, document, scan and video in the app breaks at once, for all
-- 304 swimmers, with no warning to anybody.
--
-- The app asks Supabase for a one-hour link each time it shows a file, so nothing in the
-- interface changes. A signed link still leaks if somebody forwards it — but it stops being a
-- permanent public address for a child's passport, which is what it is today.

begin;

update storage.buckets set public = false where id = 'vx-media';

-- Only a signed-in user may read, write or replace anything in it. These were granted to anon
-- as well until tonight, which meant anybody could add files to the club's storage or overwrite
-- a child's medical certificate without an account.
drop policy if exists "vx-media read" on storage.objects;
create policy "vx-media read" on storage.objects
  for select to authenticated using (bucket_id = 'vx-media');

drop policy if exists "vx-media insert" on storage.objects;
create policy "vx-media insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'vx-media');

drop policy if exists "vx-media update" on storage.objects;
create policy "vx-media update" on storage.objects
  for update to authenticated
  using (bucket_id = 'vx-media') with check (bucket_id = 'vx-media');

commit;

-- Check it worked:
--   select id, public from storage.buckets;          -- vx-media must now be false
--
-- Then, in the app: open a swimmer with a photograph and a document on file. Both should still
-- appear. If a photo is blank, the device is on an older build — force-close and reopen.
--
-- To undo, if something is wrong and families cannot see their documents:
--   update storage.buckets set public = true where id = 'vx-media';

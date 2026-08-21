-- Make the media bucket private. RUN THIS LAST.
--
-- ============================================================================
--  APPLIED — 21 August 2026, to the live project (qhrpwiakobgcxfmcoyfg).
--
--  Before:  vx-media public = true
--  After:   vx-media public = false
--  Verified after: 126 files still present, 3 storage policies, none granted to anon.
--
--  Worth recording what was found doing it, because it is the trap this file warns about
--  from the other side: the row-level-security policies on this bucket were ALREADY
--  correct — all three `to authenticated`, none open to anon. Somebody had done that
--  part. It made no difference whatsoever, because a public bucket serves files through
--  an endpoint that bypasses row-level security entirely. The one line that mattered was
--  the bucket flag.
--
--  Nothing below needs running again. It is kept because re-running it is harmless and
--  because the reasoning is the record.
-- ============================================================================
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

-- ---------------------------------------------------------------------------
-- PRE-FLIGHT, checked against the code on 21 Aug 2026 rather than assumed:
--
--   * Every path that displays a file goes through _mediaSrc(), which signs it. There are
--     seven of them — avatars, documents, the InBody sheet, the video player, the video
--     download link, a message attachment, and _openUrl() for opening a document.
--   * _mediaPath() matches BOTH url shapes, `.../object/vx-media/x` and
--     `.../object/public/vx-media/x`. Uploads store the second one, so the thousands of
--     public-shaped URLs already in the database keep working — they are re-signed on read,
--     not followed as links.
--   * Nothing outside proto.html touches this bucket: not the Next.js app, not
--     vortex-static, not the family portal. The service-role routes (/api/backup/*, the
--     wearable sync) bypass bucket privacy entirely and are unaffected.
--
-- ONE CAVEAT, and it is the support call you will get:
--   _signMedia() needs a live database session and returns early without one:
--       const tok=(window.__VX_AUTH && window.__VX_AUTH.token)||''; if(!tok) return;
--   A device showing the orange "Signed out — changes will not save" banner is in exactly
--   that state: the app looks signed in, but there is no token to sign links with. After this
--   migration those devices show blank photos and documents until the person signs in again.
--   Before flipping the bucket, it is worth telling coaches: if pictures go blank, sign out
--   and back in.
-- ---------------------------------------------------------------------------

-- Check it worked:
--   select id, public from storage.buckets;          -- vx-media must now be false
--
-- Then, in the app: open a swimmer with a photograph and a document on file. Both should still
-- appear. If a photo is blank, the device is on an older build — force-close and reopen.
--
-- To undo, if something is wrong and families cannot see their documents:
--   update storage.buckets set public = true where id = 'vx-media';

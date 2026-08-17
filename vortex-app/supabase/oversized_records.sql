-- "3 changes have not been saved — club_state (vx_fitness_media) · no connection", and from then
-- on nothing else on that device saves either.
--
-- A fitness photo belongs in Storage, leaving a URL behind. When the storage bucket was not
-- available the app fell back to putting the image itself, base64-encoded, inside the shared
-- vx_fitness_media record. A few of those and the record is megabytes:
--
--   * the write never completes, and the browser reports that as "no connection";
--   * the failed write is replayed in order every 45 seconds, so every other write on that
--     device queues behind one that can never finish;
--   * and it does not fit in the browser's own storage either, so local writes start failing
--     silently — which is how a swimmer set to Active goes back to On break a second later.
--
-- The app no longer creates these and no longer retries them. This is for the one already in
-- the database, because every device re-downloads it on every load until it is cleaned.
--
-- Section 1 shows the sizes. Section 2 takes the images out of vx_fitness_media, keeping the
-- video links and everything else, and is commented out — read section 1 first.

-- ================================================================== 1. what is actually big
select key,
       pg_size_pretty(octet_length(value::text)::bigint)                    as size,
       octet_length(value::text)                                           as bytes,
       case when octet_length(value::text) > 900000
            then '✗ too large to sync — this is what is blocking the device'
            when octet_length(value::text) > 200000
            then '· large, worth watching'
            else '✓ fine' end                                              as verdict
  from public.club_state
 order by octet_length(value::text) desc
 limit 15;

-- How much of vx_fitness_media is images rather than data.
select count(*)                                                            as exercises,
       count(*) filter (where v->>'photo' like 'data:%')                   as with_an_image_inside,
       pg_size_pretty(sum(length(coalesce(v->>'photo','')))::bigint)       as image_bytes
  from public.club_state cs
  cross join lateral jsonb_each(
        case when jsonb_typeof(cs.value)='object' then cs.value else '{}'::jsonb end) as e(k, v)
 where cs.key = 'vx_fitness_media'
   and jsonb_typeof(v) = 'object';

-- ==================================================== 2. take the images out (COMMENTED OUT)
-- This removes ONLY the inline base64 images. Video links, and every other field, are kept.
-- The photos themselves are not recoverable from anywhere else — they were only ever inside
-- this record — so they will need uploading again once the vx-media storage bucket exists.
-- That is the trade: those photos, or nobody at the club being able to save anything.
--
-- Uncomment, run, then run section 1 again: vx_fitness_media should read ✓ fine.
--
-- update public.club_state
--    set value = (
--          select coalesce(jsonb_object_agg(k,
--                   case when v->>'photo' like 'data:%'
--                        then v || jsonb_build_object('photo', '')
--                        else v end), '{}'::jsonb)
--            from jsonb_each(value) as e(k, v)),
--        updated_at = now()
--  where key = 'vx_fitness_media'
--    and jsonb_typeof(value) = 'object';
--
-- Every device picks the smaller record up on its next sync, the queue behind it clears, and
-- saving works again. Nothing else needs doing.

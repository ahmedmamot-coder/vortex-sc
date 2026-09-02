-- ============================================================================
--  VORTEX SC — a parent can upload their own child's documents.
--
--  The family portal's Documents tab has always shown Upload buttons for the birth
--  certificate, the ID/passport copy and the medical certificate. Pressing one put the file
--  into storage (the bucket accepts any signed-in user) and was then refused when the app
--  wrote the row that says the file exists:
--
--      swimmer_docs · HTTP 403 · new row violates row-level security policy
--
--  security_4_roles.sql files swimmer_docs under per_swimmer, and that loop writes
--
--      create policy vx_s4_write ... for all to authenticated
--        using (vx_is_staff()) with check (vx_is_staff())
--
--  which is staff-only. That was the right default for a table of children's passports; it
--  just never had the exception the portal's own buttons imply. So the parent saw
--  "Uploaded, but sync failed", the club never got the document, and the file sat in the
--  bucket with nothing pointing at it.
--
--  TWO THINGS ARE FIXED HERE, and the first one is the one that matters.
--
--  Paste into Supabase -> SQL Editor -> Run. Safe to re-run. Nothing is deleted.
-- ============================================================================


-- ---------------------------------------------------------------------------------------------
--  1. vx_is_my_swimmer has never matched anything.
--
--  This is not a change of policy. It is a bug that has been silently making every family
--  per-swimmer rule behave as staff-only, and it has to be fixed before any new rule below can
--  work — a policy written against a comparison that never returns true is just staff-only with
--  extra words.
--
--  security_5_swimmer_docs.sql predicted it exactly, and left the question open rather than
--  guess:
--
--      "whether swimmer_docs.swimmer_id and family_accounts.swimmer_ids use the same shape.
--       The app stores a family's children as 'squad::id' and takes the last segment when it
--       needs the bare id, so the two are probably NOT equal and a naive join silently matches
--       nothing — which is the same outcome as staff-only, arrived at by accident."
--
--  They are not equal, and the app says so in three places:
--
--    * registration writes family_accounts.swimmer_ids from the picker, whose entries are
--      "squad::id"  — famRegister: swimmerIds: S.famPicked.slice()
--    * an upload writes swimmer_docs.swimmer_id as the bare id
--                     — uploadDoc: swimmer_id: swId, from sw.id
--    * /api/family/state carries a bareId() helper whose whole comment is this mismatch:
--      "'preteam::r3' and 'r3' both mean r3. The app stores the first, club_state uses the
--      second." The server route works around it; the database policies never did.
--
--  So vx_is_my_swimmer('r3') asks whether 'r3' is in {'preteam::r3'} and answers no. Every
--  policy built on it — attendance_marks, invoices, memberships, wellness_checkins,
--  wearable_readings, inbody_readings, meet_declarations, swimmer_docs, family_messages —
--  has been returning nothing to families since Stage 4 ran.
--
--  Comparing the last segment of both sides is the same normalisation bareId() already does,
--  and it widens nothing: it cannot match a swimmer who is not already on that family's list.
--  'preteam::r3' and 'r3' start meaning the same child, which is what they have always meant
--  everywhere else in this app.
-- ---------------------------------------------------------------------------------------------

create or replace function public.vx_bare_id(v text) returns text
language sql immutable set search_path = public, pg_temp as $$
  -- Everything up to and including the last '::' removed, which is bareId()'s .split('::').pop().
  -- A value with no '::' is returned unchanged, so a table that already stores bare ids is
  -- unaffected.
  select regexp_replace(coalesce(v, ''), '^.*::', '');
$$;

create or replace function public.vx_is_my_swimmer(id text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select id is not null
     and public.vx_bare_id(id) <> ''
     and public.vx_bare_id(id) in (select public.vx_bare_id(x) from public.vx_my_swimmer_ids() x);
$$;


-- ---------------------------------------------------------------------------------------------
--  2. A parent may add and replace their own child's documents.
--
--  INSERT and UPDATE only, and only for a child already linked to their account.
--
--  DELETE is deliberately NOT granted. A birth certificate or a medical certificate on file is
--  the club's compliance record as much as the family's paperwork, and a document leaving it
--  should be the club's decision. Replacing one is the case a parent actually needs — a photo
--  of the wrong page, an expired certificate — and Upload does that: every row is keyed
--  swimmerid::kind, so a second upload of the same kind updates the row rather than adding one.
--  The app no longer shows families a delete button, so nothing on screen promises otherwise.
--
--  The existing staff policy is left exactly as it is. These are additional permissive policies
--  beside it, which is how the two family exceptions already in security_4_roles.sql are
--  written (a parent replying to a message, a parent saying they have paid).
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.swimmer_docs') is null then
    raise notice 'vx: swimmer_docs does not exist - nothing to do';
    return;
  end if;

  drop policy if exists vx_s4_family_doc_new  on public.swimmer_docs;
  drop policy if exists vx_s4_family_doc_edit on public.swimmer_docs;

  create policy vx_s4_family_doc_new on public.swimmer_docs
    for insert to authenticated
    with check (public.vx_is_my_swimmer(swimmer_id::text));

  create policy vx_s4_family_doc_edit on public.swimmer_docs
    for update to authenticated
    using (public.vx_is_my_swimmer(swimmer_id::text))
    with check (public.vx_is_my_swimmer(swimmer_id::text));

  raise notice 'vx: a family may now add and replace their own children''s documents';
end $$;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------------------------
--  CHECK IT, rather than assuming.
--
--  Run these AS A PARENT (Supabase Studio → SQL Editor runs as the service role, which passes
--  every policy and therefore proves nothing). The honest test is the app: sign in as a family,
--  open a child's Documents tab, upload a file, and confirm it comes back as "On file" with a
--  working View button after a refresh.
--
--  What can be checked here is the comparison that was broken:
--
--    -- the two shapes, side by side, for one family
--    select f.email,
--           f.swimmer_ids                       as family_shape,
--           (select d.swimmer_id from public.swimmer_docs d limit 1) as docs_shape
--      from public.family_accounts f
--     where f.swimmer_ids is not null
--       and jsonb_array_length(f.swimmer_ids::jsonb) > 0
--     limit 3;
--
--    -- and that they now agree
--    select public.vx_bare_id('preteam::r3') = public.vx_bare_id('r3') as should_be_true;
--
--  To undo just the family exception, leaving the vx_is_my_swimmer repair in place:
--    drop policy if exists vx_s4_family_doc_new  on public.swimmer_docs;
--    drop policy if exists vx_s4_family_doc_edit on public.swimmer_docs;
-- ---------------------------------------------------------------------------------------------

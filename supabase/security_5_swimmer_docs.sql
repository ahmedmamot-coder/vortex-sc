-- ============================================================================
--  VORTEX SC — swimmer_docs: keep the public key out, and DO NOT lock families out.
--
--  BACKGROUND. supabase/swimmer_docs.sql granted select, insert, update AND delete to
--  `anon`. The anon key is hard-coded in the page source, so that made every child's
--  document index readable — and erasable — by anyone on the internet.
--
--  CHECKED ON THE LIVE PROJECT, 21 Aug 2026: this is ALREADY closed. RLS is on,
--  there are policies, and none of them grants anon. So the urgent half of this is
--  done. What remains is section 2, and section 2 is where the danger is.
--
--  THE TRAP, and it nearly went in. An earlier draft of this file read:
--
--      create policy swimmer_docs_read ... using (public.vx_is_staff());
--
--  Staff only. That breaks the family portal, because swimmer_docs is not just
--  documents: swimmer PHOTOGRAPHS live in it as kind='photo' (see _docsFetch and
--  savePhoto in proto.html). A parent's app calls _docsFetch on sign-in and again
--  every time they open their child. Staff-only reads would blank every swimmer photo
--  and empty the Documents tab for all 304 families, and the cause would look like a
--  broken image rather than a policy.
--
--  So section 2 is NOT run blind. Run section 1, then do the check, then decide.
-- ============================================================================

-- ---------------------------------------------------------------- 1. the safe half
-- Take anon out entirely. Idempotent, and it cannot lock out anybody who is signed in.
do $$
begin
  if to_regclass('public.swimmer_docs') is null then
    raise notice 'swimmer_docs does not exist - nothing to do';
    return;
  end if;
  alter table public.swimmer_docs enable row level security;
  revoke all on public.swimmer_docs from anon;
  grant select, insert, update, delete on public.swimmer_docs to authenticated;
  raise notice 'swimmer_docs: anon revoked; signed-in access unchanged';
end $$;

-- Drop any policy that still names anon, and nothing else.
do $$
declare p record;
begin
  for p in select policyname from pg_policies
           where schemaname='public' and tablename='swimmer_docs' and roles::text like '%anon%' loop
    execute format('drop policy if exists %I on public.swimmer_docs', p.policyname);
    raise notice 'dropped anon policy: %', p.policyname;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------- 2. the careful half
--  Right now any signed-in user can read every child's document index. Narrowing that to
--  "staff, or the family this child belongs to" needs one fact this file cannot assume:
--  whether swimmer_docs.swimmer_id and family_accounts.swimmer_ids use the same shape.
--  The app stores a family's children as 'squad::id' and takes the last segment when it
--  needs the bare id, so the two are probably NOT equal and a naive join silently matches
--  nothing — which is the same outcome as staff-only, arrived at by accident.
--
--  RUN THIS FIRST and read the answer:
--
--    select d.swimmer_id                          as docs_shape,
--           fa.swimmer_ids                        as family_shape
--    from public.swimmer_docs d
--    cross join lateral (select swimmer_ids from public.family_accounts limit 1) fa
--    limit 5;
--
--  Then uncomment ONE of the two policies below to match what you saw, run it, and
--  immediately check a parent account: their child's photo and Documents tab must still
--  work. If anything is blank, run the ROLLBACK at the bottom.

-- (a) the ids match exactly:
--
-- drop policy if exists swimmer_docs_read on public.swimmer_docs;
-- create policy swimmer_docs_read on public.swimmer_docs
--   for select to authenticated using (
--     public.staff_check()
--     or exists (select 1 from public.family_accounts fa
--                where lower(trim(fa.email)) = public.vx_email()
--                  and fa.swimmer_ids ? swimmer_docs.swimmer_id)
--   );

-- (b) the family stores 'squad::id' and the docs store the bare id:
--
-- drop policy if exists swimmer_docs_read on public.swimmer_docs;
-- create policy swimmer_docs_read on public.swimmer_docs
--   for select to authenticated using (
--     public.staff_check()
--     or exists (select 1 from public.family_accounts fa,
--                     lateral jsonb_array_elements_text(fa.swimmer_ids) as sid
--                where lower(trim(fa.email)) = public.vx_email()
--                  and split_part(sid, '::', 2) = swimmer_docs.swimmer_id)
--   );

-- Writes stay with staff either way — a parent does not upload to another child's record:
--
-- drop policy if exists swimmer_docs_write on public.swimmer_docs;
-- create policy swimmer_docs_write on public.swimmer_docs
--   for all to authenticated using (public.staff_check()) with check (public.staff_check());

-- ROLLBACK for section 2 — reopens reads to any signed-in user, which is where it is today:
--   drop policy if exists swimmer_docs_read on public.swimmer_docs;
--   create policy swimmer_docs_read on public.swimmer_docs
--     for select to authenticated using (true);

-- Prove section 1 worked. With the PUBLIC anon key this must be a permission error or an
-- empty list, never a list of documents:
--   curl "https://qhrpwiakobgcxfmcoyfg.supabase.co/rest/v1/swimmer_docs?select=id" -H "apikey: <ANON_KEY>"

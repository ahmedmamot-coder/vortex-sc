-- ============================================================================
--  VORTEX SC — close swimmer_docs to the public key.
--
--  WHY: supabase/swimmer_docs.sql granted select, insert, update AND delete to `anon`.
--  The anon key is hard-coded in the page source, so it is public by definition. That
--  made every child's document index readable by anyone on the internet — and, because
--  delete was in the list, erasable by them too.
--
--  This is the index. The FILES are a separate problem with a separate fix: run
--  vortex-app/supabase/media_private.sql to take the vx-media bucket out of public
--  reach. Locking this table without that one hides the list and leaves the documents.
--
--  AFTER THIS: staff read and write the index. A family reads only its own children's
--  rows. Nobody anonymous touches it at all.
--
--  Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
-- ============================================================================
do $$
declare p text;
begin
  if to_regclass('public.swimmer_docs') is null then
    raise notice 'swimmer_docs does not exist - nothing to do';
    return;
  end if;

  alter table public.swimmer_docs enable row level security;

  -- anon keeps no grant at all here: the table is never read before sign-in.
  revoke all on public.swimmer_docs from anon;
  grant select, insert, update, delete on public.swimmer_docs to authenticated;

  for p in select policyname from pg_policies
           where schemaname='public' and tablename='swimmer_docs' loop
    execute format('drop policy if exists %I on public.swimmer_docs', p);
  end loop;

  if to_regproc('public.vx_is_staff') is not null then
    create policy swimmer_docs_read on public.swimmer_docs
      for select to authenticated using (public.vx_is_staff());
    create policy swimmer_docs_insert on public.swimmer_docs
      for insert to authenticated with check (public.vx_is_staff());
    create policy swimmer_docs_update on public.swimmer_docs
      for update to authenticated using (public.vx_is_staff()) with check (public.vx_is_staff());
    create policy swimmer_docs_delete on public.swimmer_docs
      for delete to authenticated using (public.vx_is_staff());
    raise notice 'swimmer_docs: writable and readable by staff only';
  else
    -- vx_is_staff() is what security_4_roles.sql creates. Without it the honest thing is to
    -- shut the table rather than fall back to "any signed-in user", which is how vx_squads_t
    -- ended up permissive and stayed that way.
    create policy swimmer_docs_read on public.swimmer_docs
      for select to authenticated using (false);
    raise notice 'swimmer_docs: CLOSED. vx_is_staff() does not exist - run security_4_roles.sql, then run this file again.';
  end if;
end $$;

notify pgrst, 'reload schema';

-- Prove it is closed. With your PUBLIC anon key this must return a permission error or
-- an empty list, never a list of documents:
--   curl "https://<project>.supabase.co/rest/v1/swimmer_docs?select=id" -H "apikey: <ANON_KEY>"

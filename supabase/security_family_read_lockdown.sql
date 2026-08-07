-- ============================================================================
--  VORTEX SC — close the last privacy gap on family_accounts.
--
--  WHY: family_accounts was readable by `anon`, and the anon key is public in the
--  page source. Anyone who viewed source could download every parent's name, email,
--  phone number and which children they are linked to.
--
--  It was open because the login screen used to look an account up BEFORE sign-in.
--  The app no longer does that: it authenticates first and reads the account after,
--  rebuilding it from the auth user's own metadata if the row isn't there yet.
--
--  AFTER THIS: reading requires a signed-in user. Registering (INSERT) stays open,
--  because signing up necessarily happens before you have a session. Changing or
--  deleting an account stays signed-in only.
--
--  ORDER MATTERS: deploy the app first, then run this. If you run it against the old
--  app, family sign-in breaks (it would try to read the table while still anonymous).
--
--  Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
-- ============================================================================
do $$
declare p text;
begin
  if to_regclass('public.family_accounts') is null then
    raise notice 'family_accounts does not exist - nothing to do';
    return;
  end if;

  alter table public.family_accounts enable row level security;
  grant select, insert, update, delete on public.family_accounts to anon, authenticated;

  for p in select policyname from pg_policies
           where schemaname='public' and tablename='family_accounts' loop
    execute format('drop policy if exists %I on public.family_accounts', p);
  end loop;

  -- Sign-up happens before a session exists, so INSERT stays open to anon.
  create policy fam_reg_insert on public.family_accounts
    for insert to anon, authenticated with check (true);

  -- Everything else requires a signed-in user. This is the change.
  create policy fam_select on public.family_accounts
    for select to authenticated using (true);
  create policy fam_update on public.family_accounts
    for update to authenticated using (true) with check (true);
  create policy fam_delete on public.family_accounts
    for delete to authenticated using (true);
end $$;

notify pgrst, 'reload schema';

-- Verify — `select` should be {authenticated}, `insert` {anon,authenticated}:
--   select policyname, cmd, roles from pg_policies
--   where schemaname='public' and tablename='family_accounts' order by cmd;
--
-- Prove it's closed (run in a terminal, with your PUBLIC anon key). Expect a
-- permission error / empty result rather than a list of parents:
--   curl "https://qhrpwiakobgcxfmcoyfg.supabase.co/rest/v1/family_accounts?select=email" \
--        -H "apikey: <ANON_KEY>"

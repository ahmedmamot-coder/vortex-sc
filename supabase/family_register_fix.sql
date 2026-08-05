-- ============================================================================
--  VORTEX SC — FIX: parent registrations never reached the database.
--
--  WHY: the lockdown allows INSERT on family_accounts only for `authenticated`.
--  But registering IS a pre-login action — at signup the parent has no session yet
--  (and with "Confirm email" ON, Supabase issues no token at all until they click the
--  link). So the new row was refused and the admin saw 0 family accounts, even though
--  the parent had signed up successfully.
--
--  WHAT THIS DOES: lets an anonymous visitor INSERT a family_accounts row (sign-up),
--  while still blocking anonymous UPDATE and DELETE — so nobody can alter or remove
--  another family's record, or change which children a login can see. Those remain
--  signed-in-only, exactly as the lockdown intended.
--
--  Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
-- ============================================================================
do $$
begin
  if to_regclass('public.family_accounts') is null then
    raise notice 'family_accounts does not exist - nothing to do';
    return;
  end if;

  -- Registration (INSERT) must be possible before the parent is signed in.
  drop policy if exists lk_insert       on public.family_accounts;
  drop policy if exists fam_reg_insert  on public.family_accounts;
  create policy fam_reg_insert on public.family_accounts
    for insert to anon, authenticated with check (true);

  -- Changing or deleting an account stays signed-in only (unchanged from the lockdown).
  drop policy if exists lk_update on public.family_accounts;
  drop policy if exists lk_delete on public.family_accounts;
  create policy lk_update on public.family_accounts
    for update to authenticated using (true) with check (true);
  create policy lk_delete on public.family_accounts
    for delete to authenticated using (true);

  -- Reading stays as the lockdown set it (anon + authenticated), which the login
  -- screen needs in order to find an account before a session exists.
  drop policy if exists lk_select on public.family_accounts;
  create policy lk_select on public.family_accounts
    for select to anon, authenticated using (true);
end $$;

-- Check what you now have:
--   select policyname, cmd, roles from pg_policies
--   where schemaname='public' and tablename='family_accounts' order by cmd;

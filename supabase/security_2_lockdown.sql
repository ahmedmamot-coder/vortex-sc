-- ============================================================================
--  VORTEX SC — SECURITY STEP 2: the lockdown.
--  AFTER you have (1) deployed the app, (2) turned OFF email confirmation in
--  Supabase Auth, (3) logged in as every staff member once, and (4) run
--  security_1_admins.sql — run this.
--
--  What it does (Tier 1 — safe with the current app):
--    • Blocks ALL anonymous WRITES and DELETES on every table. A random visitor
--      can no longer modify, inject, or wipe club data.
--    • Locks READS of sensitive / minors' data (documents, health, messages,
--      push subs) to signed-in users only.
--    • Keeps READS open on the few tables the app needs before login
--      (club_state for boot, family/staff accounts for the login screen).
--    • Signed-in users (all staff + families) keep full use. Admins get
--      everything. NB: this table set intentionally EXCLUDES wearable_connections
--      (OAuth tokens) which stays server-only.
--
--  If anything misbehaves, run security_3_rollback.sql to reopen instantly.
--  Safe to re-run.
-- ============================================================================
do $$
declare
  t text; p text;
  -- reads allowed to anon (needed before a user logs in) + all writes authenticated-only
  anon_read text[] := array['club_state','family_accounts','staff_accounts'];
  -- fully signed-in only (reads + writes) — sensitive / post-login data
  auth_only text[] := array[
    'plan_sessions','fitness_sessions','squad_plans','season_plans','fitness_plans',
    'swimmer_docs','push_subscriptions','announcements','family_messages','signup_alerts',
    'lounge_posts','lounge_comments','wearable_readings','hr_sets','wellness_checkins'
  ];
  all_t text[];
begin
  all_t := anon_read || auth_only;
  foreach t in array all_t loop
    if to_regclass('public.'||t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    -- drop EVERY existing policy on the table so old permissive ones can't leak access
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
    -- writes: signed-in users only (this is what stops anonymous tampering/deletion)
    execute format('create policy lk_insert on public.%I for insert to authenticated with check (true)', t);
    execute format('create policy lk_update on public.%I for update to authenticated using (true) with check (true)', t);
    execute format('create policy lk_delete on public.%I for delete to authenticated using (true)', t);
  end loop;

  foreach t in array anon_read loop
    if to_regclass('public.'||t) is null then continue; end if;
    execute format('create policy lk_select on public.%I for select to anon, authenticated using (true)', t);
  end loop;

  foreach t in array auth_only loop
    if to_regclass('public.'||t) is null then continue; end if;
    execute format('create policy lk_select on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

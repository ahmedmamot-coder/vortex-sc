-- ============================================================================
--  VORTEX SC — SECURITY ROLLBACK: undo the lockdown instantly.
--  Reopens every table to anon + authenticated (the pre-lockdown state), so the
--  app works exactly as before. Run this if the lockdown breaks anything.
--  Does NOT touch wearable_connections (stays server-only). Safe to re-run.
-- ============================================================================
do $$
declare
  t text; p text;
  all_t text[] := array[
    'club_state','family_accounts','staff_accounts',
    'plan_sessions','fitness_sessions','squad_plans','season_plans','fitness_plans',
    'swimmer_docs','push_subscriptions','announcements','family_messages','signup_alerts',
    'lounge_posts','lounge_comments','wearable_readings','hr_sets','wellness_checkins'
  ];
begin
  foreach t in array all_t loop
    if to_regclass('public.'||t) is null then continue; end if;
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
    execute format('create policy open_all on public.%I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

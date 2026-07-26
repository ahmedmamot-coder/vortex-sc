-- ============================================================================
--  VORTEX SC — turn on Realtime (live push) for the whole app, so every device
--  updates the instant data changes — no manual refresh. Idempotent & safe to re-run.
--  Paste into Supabase -> SQL Editor -> Run.
-- ============================================================================
do $$
declare
  t text;
  tabs text[] := array[
    'club_state','attendance_marks',
    'plan_sessions','fitness_sessions','squad_plans','season_plans','fitness_plans',
    'family_messages','announcements','signup_alerts','lounge_posts','lounge_comments',
    'swimmer_docs','wearable_readings','hr_sets','wellness_checkins',
    'family_accounts','staff_accounts'
  ];
begin
  foreach t in array tabs loop
    if to_regclass('public.'||t) is null then continue; end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

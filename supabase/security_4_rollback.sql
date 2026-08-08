-- =====================================================================================
--  VORTEX SC — undo Stage 4
-- =====================================================================================
--  Puts every table back to "any signed-in user may do anything", which is where it was
--  before security_4_roles.sql. Run this if a coach or a parent is locked out of
--  something they need and it cannot wait — then work out which policy was wrong and
--  put the lockdown back. It leaves the vx_staff_emails list and the helper functions
--  alone so the second attempt does not start from nothing.
--
--  Anyone signed in can read and change the whole club again while this is in force.
-- =====================================================================================

do $$
declare
  t text;
  tables text[] := array[
    'club_state','attendance_marks','family_messages','family_accounts','staff_accounts',
    'swimmer_docs','wellness_checkins','hr_sets','wearable_readings','announcements',
    'plan_sessions','squad_plans','season_plans','fitness_plans','fitness_sessions',
    'lounge_posts','lounge_comments','signup_alerts'
  ];
  p record;
begin
  foreach t in array tables loop
    if to_regclass('public.'||t) is null then continue; end if;

    -- drop everything Stage 4 created on this table
    for p in select policyname from pg_policies
              where schemaname='public' and tablename=t and policyname like 'vx4_%' loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;

    execute format('drop policy if exists lk_select on public.%I', t);
    execute format('drop policy if exists lk_insert on public.%I', t);
    execute format('drop policy if exists lk_update on public.%I', t);
    execute format('drop policy if exists lk_delete on public.%I', t);

    execute format('create policy lk_select on public.%I for select to anon, authenticated using (true)', t);
    execute format('create policy lk_insert on public.%I for insert to authenticated with check (true)', t);
    execute format('create policy lk_update on public.%I for update to authenticated using (true) with check (true)', t);
    execute format('create policy lk_delete on public.%I for delete to authenticated using (true)', t);
  end loop;
end $$;

select 'rolled back' as check, count(*)::text as policies_now_open
  from pg_policies where schemaname='public' and policyname like 'lk_%';

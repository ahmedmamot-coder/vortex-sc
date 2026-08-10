-- Undo Stage 4.
--
-- Puts every table back to "any signed-in user can read and write", which is where the project
-- was before security_4_roles.sql. Run this if a coach cannot mark a register, a parent cannot
-- see their own child, or a family cannot register — those are the shapes a too-tight policy
-- takes, and the app reports a refused write as "this account is not allowed to make that
-- change" rather than a silent failure.
--
-- Keep it open in another tab while testing Stage 4. Being able to undo in ten seconds is the
-- difference between trying it and not.

begin;

do $$
declare
  t text;
  tables text[] := array[
    'plan_sessions','squad_plans','season_plans','fitness_plans','fitness_sessions',
    'lounge_posts','lounge_comments','signup_alerts','staff_accounts',
    'wellness_checkins','wearable_readings','hr_sets','attendance_marks',
    'inbody_readings','invoices','memberships','meet_declarations',
    'swimmer_docs','family_messages','family_accounts','announcements',
    'push_subscriptions','club_state'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.'||t) is null then continue; end if;
    -- Everything, not only the vx_s4_* names. Stage 4 clears each table before it writes its
    -- own policies, so the originals are already gone and leaving half of a mixed set behind
    -- would be its own puzzle. This restores one known-open state instead.
    declare p text;
    begin
      for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
        execute format('drop policy if exists %I on public.%I', p, t);
      end loop;
    end;
    execute format('create policy vx_open_read on public.%I for select to authenticated using (true)', t);
    execute format('create policy vx_open_write on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- The helper functions are left in place: they read nothing on their own and dropping them
-- would fail while any policy still refers to them. Drop them by hand once you are sure Stage 4
-- is not going back on:
--   drop function if exists vx_is_my_swimmer(text);
--   drop function if exists vx_my_swimmer_ids();
--   drop function if exists vx_is_staff();
--   drop function if exists vx_email();
--   drop table if exists vx_staff_emails;

commit;

-- ============================================================================
--  VORTEX SC — ROLL BACK the Stage C lockdown.
--  Run this if plans / sessions / lounge / messages show empty or won't save on
--  some devices. It reopens reads & deletes to the app again (pre-Stage-C state),
--  which is needed because staff logins are not yet carrying a token reliably.
--  Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
-- ============================================================================

-- reopen READS to the app (anon + authenticated)
drop policy if exists family_messages_read on public.family_messages;
create policy family_messages_read on public.family_messages for select to anon, authenticated using (true);
drop policy if exists signup_alerts_read on public.signup_alerts;
create policy signup_alerts_read on public.signup_alerts for select to anon, authenticated using (true);
drop policy if exists plan_sessions_read on public.plan_sessions;
create policy plan_sessions_read on public.plan_sessions for select to anon, authenticated using (true);
drop policy if exists fitness_sessions_read on public.fitness_sessions;
create policy fitness_sessions_read on public.fitness_sessions for select to anon, authenticated using (true);
drop policy if exists fitness_plans_read on public.fitness_plans;
create policy fitness_plans_read on public.fitness_plans for select to anon, authenticated using (true);
drop policy if exists squad_plans_read on public.squad_plans;
create policy squad_plans_read on public.squad_plans for select to anon, authenticated using (true);
drop policy if exists season_plans_read on public.season_plans;
create policy season_plans_read on public.season_plans for select to anon, authenticated using (true);
drop policy if exists lounge_read on public.lounge_posts;
create policy lounge_read on public.lounge_posts for select to anon, authenticated using (true);
drop policy if exists lounge_comments_read on public.lounge_comments;
create policy lounge_comments_read on public.lounge_comments for select to anon, authenticated using (true);

-- reopen DELETES to the app (anon + authenticated)
drop policy if exists club_state_delete on public.club_state;
create policy club_state_delete on public.club_state for delete to anon, authenticated using (true);
drop policy if exists plan_sessions_delete on public.plan_sessions;
create policy plan_sessions_delete on public.plan_sessions for delete to anon, authenticated using (true);
drop policy if exists fitness_sessions_delete on public.fitness_sessions;
create policy fitness_sessions_delete on public.fitness_sessions for delete to anon, authenticated using (true);
drop policy if exists staff_accounts_delete on public.staff_accounts;
create policy staff_accounts_delete on public.staff_accounts for delete to anon, authenticated using (true);

-- ============================================================================
--  VORTEX SC — SECURITY STAGE C (safe, reversible increment)
--  Paste into Supabase → SQL Editor → Run.
--
--  WHAT THIS DOES (safe to apply while the club is live):
--   1) Stops ANY anonymous (not-logged-in) user from READING your private
--      per-family/coaching data: parent<->coach messages, saved training plans,
--      season plans, dryland plans, admin sign-up alerts, and the Lounge.
--   2) Stops ANY anonymous user from DELETING data in ANY table (only signed-in
--      users can delete). This closes the "anyone on the internet can wipe the
--      database" risk.
--
--  WHAT THIS DOES NOT DO YET (needs the data-move step — do NOT lock these here
--  or the app/login will break):
--   - club_state  : holds documents/medical/roster in one shared blob that the
--                   app reads BEFORE login. Must be split into per-owner rows first.
--   - staff_accounts : login reads it (PINs) before anyone is authenticated.
--   - family_accounts : the app restores the family session from it at startup.
--
--  PREREQUISITE: families AND staff must already get a JWT on login
--  (window.__vxAuthUid() returns an id). If not, DO NOT run this yet.
--
--  ROLLBACK: if anything misbehaves on the live site, run the ROLLBACK block at
--  the bottom of this file — it reopens everything in seconds.
-- ============================================================================

-- ---- 1) Lock READS to signed-in users on the private per-row tables ----------
-- family_messages (private staff <-> family thread)
drop policy if exists family_messages_read on public.family_messages;
create policy family_messages_read on public.family_messages for select to authenticated using (true);

-- signup_alerts (admin notifications)
drop policy if exists signup_alerts_read on public.signup_alerts;
create policy signup_alerts_read on public.signup_alerts for select to authenticated using (true);

-- plan_sessions (saved swim sessions)
drop policy if exists plan_sessions_read on public.plan_sessions;
create policy plan_sessions_read on public.plan_sessions for select to authenticated using (true);

-- fitness_sessions (saved dryland sessions)
drop policy if exists fitness_sessions_read on public.fitness_sessions;
create policy fitness_sessions_read on public.fitness_sessions for select to authenticated using (true);

-- fitness_plans (editable dryland plan per squad)
drop policy if exists fitness_plans_read on public.fitness_plans;
create policy fitness_plans_read on public.fitness_plans for select to authenticated using (true);

-- squad_plans (live training plan per squad)
drop policy if exists squad_plans_read on public.squad_plans;
create policy squad_plans_read on public.squad_plans for select to authenticated using (true);

-- season_plans (periodization)
drop policy if exists season_plans_read on public.season_plans;
create policy season_plans_read on public.season_plans for select to authenticated using (true);

-- lounge_posts + lounge_comments (staff feed)
drop policy if exists lounge_read on public.lounge_posts;
create policy lounge_read on public.lounge_posts for select to authenticated using (true);
drop policy if exists lounge_comments_read on public.lounge_comments;
create policy lounge_comments_read on public.lounge_comments for select to authenticated using (true);

-- ---- 2) Block anonymous DELETE everywhere (only signed-in users can delete) ---
drop policy if exists club_state_delete on public.club_state;
create policy club_state_delete on public.club_state for delete to authenticated using (true);

drop policy if exists plan_sessions_delete on public.plan_sessions;
create policy plan_sessions_delete on public.plan_sessions for delete to authenticated using (true);

drop policy if exists fitness_sessions_delete on public.fitness_sessions;
create policy fitness_sessions_delete on public.fitness_sessions for delete to authenticated using (true);

drop policy if exists staff_accounts_delete on public.staff_accounts;
create policy staff_accounts_delete on public.staff_accounts for delete to authenticated using (true);

-- (family_accounts/squad_plans/season_plans/fitness_plans have no anon delete path
--  in the app; add here later if you ever grant delete on them.)

-- ============================================================================
--  ROLLBACK — run ONLY this block if something breaks on the live site.
--  It reopens reads/deletes to anonymous again (back to the pre-Stage-C state).
-- ============================================================================
-- drop policy if exists family_messages_read on public.family_messages;
-- create policy family_messages_read on public.family_messages for select to anon, authenticated using (true);
-- drop policy if exists signup_alerts_read on public.signup_alerts;
-- create policy signup_alerts_read on public.signup_alerts for select to anon, authenticated using (true);
-- drop policy if exists plan_sessions_read on public.plan_sessions;
-- create policy plan_sessions_read on public.plan_sessions for select to anon, authenticated using (true);
-- drop policy if exists fitness_sessions_read on public.fitness_sessions;
-- create policy fitness_sessions_read on public.fitness_sessions for select to anon, authenticated using (true);
-- drop policy if exists fitness_plans_read on public.fitness_plans;
-- create policy fitness_plans_read on public.fitness_plans for select to anon, authenticated using (true);
-- drop policy if exists squad_plans_read on public.squad_plans;
-- create policy squad_plans_read on public.squad_plans for select to anon, authenticated using (true);
-- drop policy if exists season_plans_read on public.season_plans;
-- create policy season_plans_read on public.season_plans for select to anon, authenticated using (true);
-- drop policy if exists lounge_read on public.lounge_posts;
-- create policy lounge_read on public.lounge_posts for select to anon, authenticated using (true);
-- drop policy if exists lounge_comments_read on public.lounge_comments;
-- create policy lounge_comments_read on public.lounge_comments for select to anon, authenticated using (true);
-- drop policy if exists club_state_delete on public.club_state;
-- create policy club_state_delete on public.club_state for delete to anon, authenticated using (true);
-- drop policy if exists plan_sessions_delete on public.plan_sessions;
-- create policy plan_sessions_delete on public.plan_sessions for delete to anon, authenticated using (true);
-- drop policy if exists fitness_sessions_delete on public.fitness_sessions;
-- create policy fitness_sessions_delete on public.fitness_sessions for delete to anon, authenticated using (true);
-- drop policy if exists staff_accounts_delete on public.staff_accounts;
-- create policy staff_accounts_delete on public.staff_accounts for delete to anon, authenticated using (true);

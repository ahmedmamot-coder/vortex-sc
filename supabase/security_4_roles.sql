-- =====================================================================================
--  VORTEX SC — Stage 4: tell staff and families apart
-- =====================================================================================
--  Every policy before this one was written "to authenticated using (true)".
--  "authenticated" means ANY signed-in user, and parents sign in through the same
--  Supabase Auth as coaches — so the database has been treating a parent and the head
--  coach identically. With nothing but their own login a parent could read every other
--  family's private coach messages, read and change the whole club's attendance, read
--  every swimmer's documents and health data, and delete rows outright. The app's
--  screens never offer any of that, but screens are not a security boundary. This is.
--
--  Run order:   0001..0002 → attendance.sql → the other table files → THIS FILE LAST.
--  Undo with:   security_4_rollback.sql
--
--  ⚠️  Run this on a STAGING Supabase project and a branch preview first. It changes who
--      can read a club of children's data. Have the rollback open in another tab.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
--  STEP 1 — who is staff
-- -------------------------------------------------------------------------------------
--  Staff are recognised by the email they sign in with. Most come from staff_accounts;
--  the club's original two managers were built into the app rather than that table, so
--  they must be named here by hand or they will lock themselves out.
create table if not exists public.vx_staff_emails (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.vx_staff_emails enable row level security;

-- Everyone who already has an email on a staff account.
insert into public.vx_staff_emails (email, note)
  select distinct lower(trim(email)), 'from staff_accounts'
    from public.staff_accounts
   where coalesce(trim(email),'') <> ''
on conflict (email) do nothing;

--  ⚠️  EDIT THIS BEFORE RUNNING: the managers' own sign-in emails.
--      These are the accounts built into the app (Ahmed, Sameh). Use the exact address
--      each of them types on the sign-in screen.
insert into public.vx_staff_emails (email, note) values
  (lower('ahmedmamot@gmail.com'), 'manager — built-in account')
  -- , (lower('sameh@example.com'), 'manager — built-in account')
on conflict (email) do nothing;

--  Refuses to go further rather than locking the whole club out of its own database.
do $$
begin
  if (select count(*) from public.vx_staff_emails) = 0 then
    raise exception 'vx_staff_emails is empty — add the staff sign-in emails above first, or every coach loses access.';
  end if;
end $$;

-- -------------------------------------------------------------------------------------
--  STEP 2 — the two questions every policy asks
-- -------------------------------------------------------------------------------------
--  security definer so the checks themselves are not subject to the policies they feed.
create or replace function public.vx_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.vx_staff_emails e
     where e.email = lower(coalesce(auth.jwt() ->> 'email', ''))
       and coalesce(auth.jwt() ->> 'email', '') <> ''
  );
$$;

--  The swimmer ids linked to the family account signing in. Links are stored as
--  "squadId::swimmerId", and older ones as a bare id, so both shapes are read.
create or replace function public.vx_my_swimmer_ids() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct
           case when position('::' in x.v) > 0 then split_part(x.v, '::', 2) else x.v end), '{}')
    from public.family_accounts f
    cross join lateral jsonb_array_elements_text(coalesce(f.swimmer_ids, '[]'::jsonb)) as x(v)
   where lower(coalesce(f.email,'')) = lower(coalesce(auth.jwt() ->> 'email', ''))
     and coalesce(auth.jwt() ->> 'email', '') <> '';
$$;

create or replace function public.vx_is_my_swimmer(sw text) returns boolean
language sql stable security definer set search_path = public as $$
  select sw is not null and sw = any (public.vx_my_swimmer_ids());
$$;

revoke all on function public.vx_is_staff() from public;
revoke all on function public.vx_my_swimmer_ids() from public;
revoke all on function public.vx_is_my_swimmer(text) from public;
grant execute on function public.vx_is_staff() to anon, authenticated;
grant execute on function public.vx_my_swimmer_ids() to anon, authenticated;
grant execute on function public.vx_is_my_swimmer(text) to anon, authenticated;

-- The allowlist itself is staff-only to read and change.
drop policy if exists vx_staff_emails_all on public.vx_staff_emails;
create policy vx_staff_emails_all on public.vx_staff_emails
  for all to authenticated using (public.vx_is_staff()) with check (public.vx_is_staff());

-- -------------------------------------------------------------------------------------
--  STEP 3 — the policies
-- -------------------------------------------------------------------------------------
do $$
declare
  t text;
  swcol text;
  -- Coaching material. A family portal shows none of it, so none of it needs to leave
  -- the coaching staff.
  staff_only text[] := array[
    'plan_sessions','squad_plans','season_plans','fitness_plans','fitness_sessions',
    'lounge_posts','lounge_comments','signup_alerts'
  ];
  -- A swimmer's own record. Staff see the club; a family sees the children they are
  -- linked to, and nobody else's.
  per_swimmer text[] := array[
    'family_messages','swimmer_docs','wellness_checkins','hr_sets','wearable_readings',
    'attendance_marks'
  ];
begin
  -- ---- coaching material: staff only ----
  foreach t in array staff_only loop
    if to_regclass('public.'||t) is null then continue; end if;
    execute format('drop policy if exists lk_select on public.%I', t);
    execute format('drop policy if exists lk_insert on public.%I', t);
    execute format('drop policy if exists lk_update on public.%I', t);
    execute format('drop policy if exists lk_delete on public.%I', t);
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format('drop policy if exists vx4_all on public.%I', t);
    execute format('create policy vx4_all on public.%I for all to authenticated using (public.vx_is_staff()) with check (public.vx_is_staff())', t);
  end loop;

  -- ---- per-swimmer records: staff see all, a family sees its own children ----
  foreach t in array per_swimmer loop
    if to_regclass('public.'||t) is null then continue; end if;
    -- these tables name the swimmer column differently
    swcol := case t when 'family_messages' then 'swimmer_id' else 'sw_id' end;
    if to_regclass('public.'||t) is not null
       and not exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name=t and column_name=swcol) then
      swcol := case swcol when 'sw_id' then 'swimmer_id' else 'sw_id' end;
    end if;

    execute format('drop policy if exists lk_select on public.%I', t);
    execute format('drop policy if exists lk_insert on public.%I', t);
    execute format('drop policy if exists lk_update on public.%I', t);
    execute format('drop policy if exists lk_delete on public.%I', t);
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('drop policy if exists attm_lk_select on public.%I', t);
    execute format('drop policy if exists attm_lk_insert on public.%I', t);
    execute format('drop policy if exists attm_lk_update on public.%I', t);
    execute format('drop policy if exists attm_lk_delete on public.%I', t);
    execute format('drop policy if exists vx4_select on public.%I', t);
    execute format('drop policy if exists vx4_write  on public.%I', t);
    execute format('drop policy if exists vx4_update on public.%I', t);
    execute format('drop policy if exists vx4_delete on public.%I', t);

    execute format($f$create policy vx4_select on public.%I for select to authenticated
                     using (public.vx_is_staff() or public.vx_is_my_swimmer(%I::text))$f$, t, swcol);
    execute format($f$create policy vx4_write on public.%I for insert to authenticated
                     with check (public.vx_is_staff() or public.vx_is_my_swimmer(%I::text))$f$, t, swcol);
    execute format($f$create policy vx4_update on public.%I for update to authenticated
                     using (public.vx_is_staff() or public.vx_is_my_swimmer(%I::text))
                     with check (public.vx_is_staff() or public.vx_is_my_swimmer(%I::text))$f$, t, swcol, swcol);
    -- Deleting somebody's record is a coaching decision.
    execute format('create policy vx4_delete on public.%I for delete to authenticated using (public.vx_is_staff())', t);
  end loop;
end $$;

-- ---- the register: a family reads its own children, only staff mark it ----------------
drop policy if exists vx4_write  on public.attendance_marks;
drop policy if exists vx4_update on public.attendance_marks;
create policy vx4_write  on public.attendance_marks for insert to authenticated with check (public.vx_is_staff());
create policy vx4_update on public.attendance_marks for update to authenticated using (public.vx_is_staff()) with check (public.vx_is_staff());

-- ---- family accounts: a family sees its own row, staff see the list -------------------
--  Registration still works: a new parent may create the row that carries their own
--  email, and nobody else's.
drop policy if exists family_accounts_read   on public.family_accounts;
drop policy if exists family_accounts_insert on public.family_accounts;
drop policy if exists family_accounts_update on public.family_accounts;
drop policy if exists family_accounts_delete on public.family_accounts;
drop policy if exists lk_select on public.family_accounts;
drop policy if exists lk_insert on public.family_accounts;
drop policy if exists lk_update on public.family_accounts;
drop policy if exists lk_delete on public.family_accounts;
create policy vx4_fam_select on public.family_accounts for select to authenticated
  using (public.vx_is_staff() or lower(coalesce(email,'')) = lower(coalesce(auth.jwt() ->> 'email','')));
create policy vx4_fam_insert on public.family_accounts for insert to authenticated
  with check (public.vx_is_staff() or lower(coalesce(email,'')) = lower(coalesce(auth.jwt() ->> 'email','')));
create policy vx4_fam_update on public.family_accounts for update to authenticated
  using (public.vx_is_staff() or lower(coalesce(email,'')) = lower(coalesce(auth.jwt() ->> 'email','')))
  with check (public.vx_is_staff() or lower(coalesce(email,'')) = lower(coalesce(auth.jwt() ->> 'email','')));
create policy vx4_fam_delete on public.family_accounts for delete to authenticated using (public.vx_is_staff());

-- ---- staff accounts: anyone may still look up a username to sign in, nobody but staff
--      may change one. Deleting a colleague's account was open to every signed-in user.
drop policy if exists staff_accounts_insert on public.staff_accounts;
drop policy if exists staff_accounts_update on public.staff_accounts;
drop policy if exists staff_accounts_delete on public.staff_accounts;
drop policy if exists lk_insert on public.staff_accounts;
drop policy if exists lk_update on public.staff_accounts;
drop policy if exists lk_delete on public.staff_accounts;
create policy vx4_staff_insert on public.staff_accounts for insert to authenticated with check (public.vx_is_staff());
create policy vx4_staff_update on public.staff_accounts for update to authenticated using (public.vx_is_staff()) with check (public.vx_is_staff());
create policy vx4_staff_delete on public.staff_accounts for delete to authenticated using (public.vx_is_staff());

-- ---- announcements: the club writes them, everyone signed in reads them ---------------
do $$ begin
  if to_regclass('public.announcements') is not null then
    execute 'drop policy if exists lk_insert on public.announcements';
    execute 'drop policy if exists lk_update on public.announcements';
    execute 'drop policy if exists lk_delete on public.announcements';
    execute 'drop policy if exists vx4_ann_write on public.announcements';
    execute 'create policy vx4_ann_write on public.announcements for insert to authenticated with check (public.vx_is_staff())';
    execute 'drop policy if exists vx4_ann_update on public.announcements';
    execute 'create policy vx4_ann_update on public.announcements for update to authenticated using (public.vx_is_staff()) with check (public.vx_is_staff())';
    execute 'drop policy if exists vx4_ann_delete on public.announcements';
    execute 'create policy vx4_ann_delete on public.announcements for delete to authenticated using (public.vx_is_staff())';
  end if;
end $$;

-- ---- club_state: the shared blob ------------------------------------------------------
--  This one table holds the whole club in a handful of JSON rows — roster, fees,
--  memberships, billing, staff overrides. Row-level security cannot see inside a JSON
--  document, so it cannot give a family a partial view of one. Reads therefore stay open
--  to any signed-in user; that is the honest remaining exposure and closing it means
--  splitting the blob or serving the family portal from a server route. See DEVELOPMENT.md.
--
--  Writes are a different matter and can be pinned down now: the family portal only ever
--  writes four of these keys, so those four are all a family may write. Everything else —
--  the roster, the fees, the memberships, every staff override — is staff only. Deleting
--  a key is staff only.
drop policy if exists lk_insert on public.club_state;
drop policy if exists lk_update on public.club_state;
drop policy if exists lk_delete on public.club_state;
drop policy if exists club_state_delete on public.club_state;
drop policy if exists vx4_cs_insert on public.club_state;
drop policy if exists vx4_cs_update on public.club_state;
drop policy if exists vx4_cs_delete on public.club_state;
create policy vx4_cs_insert on public.club_state for insert to authenticated
  with check (public.vx_is_staff() or key in ('vx_billing','vx_sw_meta','vx_event_requests','vx_notifications'));
create policy vx4_cs_update on public.club_state for update to authenticated
  using      (public.vx_is_staff() or key in ('vx_billing','vx_sw_meta','vx_event_requests','vx_notifications'))
  with check (public.vx_is_staff() or key in ('vx_billing','vx_sw_meta','vx_event_requests','vx_notifications'));
create policy vx4_cs_delete on public.club_state for delete to authenticated using (public.vx_is_staff());

-- -------------------------------------------------------------------------------------
--  STEP 4 — check it before you trust it
-- -------------------------------------------------------------------------------------
--  Expect a row per staff member, and every table below owned by a vx4_ policy.
select 'staff recognised' as check, count(*)::text as value from public.vx_staff_emails
union all
select 'tables still open to any signed-in user',
       coalesce(string_agg(distinct tablename, ', '), 'none')
  from pg_policies
 where schemaname='public'
   and qual = 'true'
   and cmd in ('SELECT','INSERT','UPDATE','DELETE','ALL')
   and tablename not in ('club_state','staff_accounts');

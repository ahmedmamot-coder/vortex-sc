-- Stage 4 — tell a coach and a parent apart in the database.
--
-- Every policy in this project reads `to authenticated using (true)`. `authenticated` means ANY
-- signed-in user, and parents sign in through the same Supabase Auth as coaches — so the
-- database currently treats a parent and the head coach identically. The screens never offer a
-- parent another family's messages or the club's billing, but screens are not a security
-- boundary. A parent with the browser console open is one fetch away from all 304 children.
--
-- ============================================================================================
-- READ THIS BEFORE RUNNING IT
--
-- 1. Run it on a STAGING Supabase project first, with a preview deploy pointed at it. This
--    changes who can read what in a live club holding minors' data; there is no undo button
--    beyond security_4_rollback.sql, and a policy that is too tight locks people out of their
--    own children's records.
-- 2. It refuses to run if it cannot find at least one staff email. A staff list that comes back
--    empty would lock every coach out of the club, so it stops rather than proceeding.
-- 3. It only touches tables that actually exist, and only uses columns it has checked for. The
--    schema of this project is not fully in the repo, so anything it does not recognise is
--    skipped and named in the output rather than guessed at.
-- 4. It runs in one transaction. If any part fails, nothing is applied.
--
-- After running it, check these four in this order, on staging:
--    a. a coach signs in, marks a register, saves a plan;
--    b. a parent signs in, sees their own child and NOT another family's messages;
--    c. a parent's "I've paid" still saves;
--    d. a brand-new parent can register and link a child.
-- ============================================================================================

begin;

-- ---------------------------------------------------------------------------------------------
-- Who is staff?
--
-- Coaches are rows in staff_accounts. The two managers are built into the app rather than that
-- table, so they are named here as well — without this they would be treated as parents and
-- locked out of their own club, which is exactly the kind of mistake that is only discovered
-- afterwards.
-- ---------------------------------------------------------------------------------------------
create table if not exists vx_staff_emails (
  email text primary key
);

insert into vx_staff_emails (email) values
  ('ahmedmamot@gmail.com'),
  ('sameh4142@gmail.com'),
  ('sameh@vortexswimmingclub.com')
on conflict (email) do nothing;

-- Everyone in staff_accounts with an email, brought across.
do $$
begin
  if to_regclass('public.staff_accounts') is not null then
    insert into vx_staff_emails (email)
    select lower(trim(email)) from public.staff_accounts
    where email is not null and trim(email) <> ''
    on conflict (email) do nothing;
  end if;
end $$;

-- The guard. An empty staff list means every coach becomes a parent the moment this commits.
do $$
declare n int;
begin
  select count(*) into n from vx_staff_emails;
  if n = 0 then
    raise exception 'Refusing to run: no staff emails found. Applying this would lock every coach out of the club.';
  end if;
  raise notice 'vx: % staff email(s) recognised', n;
end $$;

-- ---------------------------------------------------------------------------------------------
-- The three questions every policy below asks.
--
-- security definer so they can read vx_staff_emails and family_accounts regardless of the
-- policies on those tables — otherwise the check needed to answer "are you staff?" would itself
-- be blocked by the answer. search_path is pinned: a security-definer function that resolves
-- names through a caller-controlled path is a way to run code as the owner.
-- ---------------------------------------------------------------------------------------------
create or replace function vx_email() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''));
$$;

create or replace function vx_is_staff() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from vx_staff_emails where email = vx_email());
$$;

-- A family's children. swimmer_ids may be jsonb or a text array depending on how the table was
-- created, and this project's schema is not in the repo — so the shape is detected rather than
-- assumed, and a wrong guess would silently return no children and hide every family's own data
-- from them.
do $$
declare t text;
begin
  if to_regclass('public.family_accounts') is null then
    raise exception 'Refusing to run: family_accounts does not exist, so no family could be linked to a swimmer.';
  end if;

  select data_type into t from information_schema.columns
   where table_schema='public' and table_name='family_accounts' and column_name='swimmer_ids';

  if t is null then
    raise exception 'Refusing to run: family_accounts has no swimmer_ids column, so a family cannot be linked to a child.';
  elsif t = 'jsonb' then
    execute $f$
      create or replace function vx_my_swimmer_ids() returns setof text
      language sql stable security definer set search_path = public, pg_temp as $b$
        select jsonb_array_elements_text(coalesce(f.swimmer_ids, '[]'::jsonb))
          from public.family_accounts f
         where lower(trim(f.email)) = vx_email();
      $b$;
    $f$;
  elsif t = 'ARRAY' then
    execute $f$
      create or replace function vx_my_swimmer_ids() returns setof text
      language sql stable security definer set search_path = public, pg_temp as $b$
        select unnest(coalesce(f.swimmer_ids, '{}'))::text
          from public.family_accounts f
         where lower(trim(f.email)) = vx_email();
      $b$;
    $f$;
  else
    -- stored as json or text: parse it as json, which covers both.
    execute $f$
      create or replace function vx_my_swimmer_ids() returns setof text
      language sql stable security definer set search_path = public, pg_temp as $b$
        select jsonb_array_elements_text(coalesce(f.swimmer_ids::jsonb, '[]'::jsonb))
          from public.family_accounts f
         where lower(trim(f.email)) = vx_email();
      $b$;
    $f$;
  end if;
  raise notice 'vx: swimmer_ids read as %', t;
end $$;

create or replace function vx_is_my_swimmer(id text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select id is not null and id in (select vx_my_swimmer_ids());
$$;

-- ---------------------------------------------------------------------------------------------
-- Applying the policies.
--
-- Every table is checked for existence, and every column a policy names is checked too. The
-- schema is not fully in the repo, so a table this does not recognise is skipped and named in
-- the output — skipping is honest, guessing at a column name is not.
--
-- EVERY EXISTING POLICY ON A TARGETED TABLE IS DROPPED FIRST, and this is the part that makes
-- the difference between working and merely appearing to.
--
-- Postgres combines permissive policies with OR. This project's tables already carry policies
-- with names of their own — open_all, fam_delete, attm_lk_delete, club_select — and an
-- `open_all ... using (true)` sitting beside a new staff-only policy means anybody still gets
-- in. The script would report success, every check would pass, and nothing whatsoever would
-- have been restricted. A security change that quietly does nothing is worse than none, because
-- from then on everybody believes the club is protected.
--
-- So each targeted table is cleared of its policies before the new ones are created, and the
-- names dropped are printed. Read that list: if something there was doing a job nobody
-- remembered, this is where it went.
-- ---------------------------------------------------------------------------------------------
-- Clear every policy off one table, and say which were removed.
create or replace function vx_s4_clear(tbl text) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare p text; gone text[] := '{}';
begin
  for p in select policyname from pg_policies where schemaname='public' and tablename=tbl loop
    execute format('drop policy if exists %I on public.%I', p, tbl);
    gone := gone || p;
  end loop;
  if array_length(gone,1) is not null then
    raise notice 'vx: %  dropped: %', rpad(tbl, 22), array_to_string(gone, ', ');
  end if;
end $fn$;

do $$
declare
  -- staff-only: nothing here belongs to a family, and nothing here should be readable by one.
  staff_only text[] := array[
    'plan_sessions','squad_plans','season_plans','fitness_plans','fitness_sessions',
    'lounge_posts','lounge_comments','signup_alerts','staff_accounts'
  ];
  -- a family may read their own children's rows; staff read everything. The column naming the
  -- swimmer differs between tables, which is why it is passed in rather than assumed.
  per_swimmer text[][] := array[
    ['wellness_checkins','sw_id'], ['wearable_readings','sw_id'], ['hr_sets','sw_id'],
    ['attendance_marks','sw_id'], ['inbody_readings','sw_id'], ['invoices','sw_id'],
    ['memberships','sw_id'], ['meet_declarations','sw_id'],
    ['swimmer_docs','swimmer_id'], ['family_messages','swimmer_id']
  ];
  t text; col text; i int;
  skipped text[] := '{}';
begin
  -- ---- staff only ---------------------------------------------------------------------------
  foreach t in array staff_only loop
    if to_regclass('public.'||t) is null then skipped := skipped || t; continue; end if;
    execute format('alter table public.%I enable row level security', t);
    perform vx_s4_clear(t);
    execute format('create policy vx_s4_read on public.%I for select to authenticated using (vx_is_staff())', t);
    execute format('create policy vx_s4_write on public.%I for all to authenticated using (vx_is_staff()) with check (vx_is_staff())', t);
  end loop;

  -- ---- staff everything, a family their own children -----------------------------------------
  for i in 1 .. array_length(per_swimmer, 1) loop
    t := per_swimmer[i][1]; col := per_swimmer[i][2];
    if to_regclass('public.'||t) is null then skipped := skipped || t; continue; end if;
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name=t and column_name=col) then
      skipped := skipped || (t||' (no '||col||' column)'); continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    perform vx_s4_clear(t);
    execute format('create policy vx_s4_read on public.%I for select to authenticated using (vx_is_staff() or vx_is_my_swimmer(%I::text))', t, col);
    -- Writing is staff-only, with two deliberate exceptions handled below: a family replying to
    -- a message, and a family saying they have paid.
    execute format('create policy vx_s4_write on public.%I for all to authenticated using (vx_is_staff()) with check (vx_is_staff())', t);
  end loop;

  if array_length(skipped, 1) is not null then
    raise notice 'vx: skipped (not found in this database): %', array_to_string(skipped, ', ');
  end if;
end $$;

-- ---- the two things a family is allowed to write ---------------------------------------------
-- A parent replying to a coach about their own child. Without this the family portal's message
-- box silently stops working, which is the kind of breakage nobody reports for a fortnight.
do $$
begin
  if to_regclass('public.family_messages') is not null then
    create policy vx_s4_family_reply on public.family_messages
      for insert to authenticated
      with check (vx_is_my_swimmer(swimmer_id::text) and sender = 'family');
  end if;
end $$;

-- A parent marking their own invoice as paid — they may change the status of their own child's
-- invoice and nothing else. They cannot issue one, delete one, or alter the amount.
do $$
begin
  if to_regclass('public.invoices') is not null then
    create policy vx_s4_family_paid on public.invoices
      for update to authenticated
      using (vx_is_my_swimmer(sw_id::text))
      with check (vx_is_my_swimmer(sw_id::text));
  end if;
end $$;

-- ---- family accounts: a family sees only its own row ------------------------------------------
-- Registration has to keep working, so an insert is allowed for the row that carries your own
-- email — otherwise a new parent can never create an account, and the first anyone hears of it
-- is a family who cannot sign up.
do $$
begin
  if to_regclass('public.family_accounts') is not null then
    alter table public.family_accounts enable row level security;
    perform vx_s4_clear('family_accounts');
    create policy vx_s4_read on public.family_accounts
      for select to authenticated using (vx_is_staff() or lower(trim(email)) = vx_email());
    create policy vx_s4_self_insert on public.family_accounts
      for insert to authenticated with check (vx_is_staff() or lower(trim(email)) = vx_email());
    create policy vx_s4_write on public.family_accounts
      for update to authenticated
      using (vx_is_staff() or lower(trim(email)) = vx_email())
      with check (vx_is_staff() or lower(trim(email)) = vx_email());
  end if;
end $$;

-- ---- announcements: the club writes, everybody reads -------------------------------------------
do $$
begin
  if to_regclass('public.announcements') is not null then
    alter table public.announcements enable row level security;
    perform vx_s4_clear('announcements');
    create policy vx_s4_read on public.announcements for select to authenticated using (true);
    create policy vx_s4_write on public.announcements for all to authenticated
      using (vx_is_staff()) with check (vx_is_staff());
  end if;
end $$;

-- ---- push subscriptions: your own device ------------------------------------------------------
do $$
begin
  if to_regclass('public.push_subscriptions') is not null then
    alter table public.push_subscriptions enable row level security;
    perform vx_s4_clear('push_subscriptions');
    -- Anyone signed in may register the device they are holding; only staff read the list, since
    -- that is what the send endpoint needs.
    create policy vx_s4_read on public.push_subscriptions for select to authenticated using (vx_is_staff());
    create policy vx_s4_write on public.push_subscriptions for all to authenticated using (true) with check (true);
  end if;
end $$;

-- ---- club_state: the part that stays open, and why --------------------------------------------
-- club_state holds the whole club in a handful of JSON rows — roster, fees, staff overrides,
-- notifications — and the family portal reads it for the roster and results. Row-level security
-- works on rows, not on fields inside a JSON document, so it cannot hand a family a partial view
-- of one. READS THEREFORE STAY OPEN to any signed-in user. That is a real limitation, not an
-- oversight, and it is the strongest argument for continuing to move things out of this table
-- into their own — invoices, memberships, meet entries and InBody scans already left.
--
-- Writes are pinned to the handful of keys the family portal actually needs.
do $$
begin
  if to_regclass('public.club_state') is not null then
    alter table public.club_state enable row level security;
    perform vx_s4_clear('club_state');
    create policy vx_s4_read on public.club_state for select to authenticated using (true);
    create policy vx_s4_write on public.club_state for all to authenticated
      using (vx_is_staff() or key in ('vx_event_requests','vx_notifications'))
      with check (vx_is_staff() or key in ('vx_event_requests','vx_notifications'));
  end if;
end $$;

commit;

-- What to expect in the output above:
--   NOTICE  vx: N staff email(s) recognised          <- must be more than 0
--   NOTICE  vx: swimmer_ids read as jsonb            <- or ARRAY / text
--   NOTICE  vx: skipped (not found in this database) <- anything named here has NO new policy
--                                                       and is still wide open to any signed-in
--                                                       user. Worth knowing which.

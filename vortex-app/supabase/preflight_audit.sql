-- What the club's database actually is, against what the app actually needs.
--
-- Reads nothing but the catalogue and writes nothing at all. Safe to run any time, on any
-- project, including during training.
--
-- Every SQL file in this repo says what SHOULD be true. None of them can tell you what IS true,
-- and the gap between the two is where this club's worst days came from:
--
--   * fitness_plans exists and holds a row, and `select=id,plan,ts,updated_at` answers 400 —
--     so every coach's fitness plan stays on the phone it was typed on, silently, for ever.
--   * vx_squads_t was created while vx_is_staff() did not exist, so its policy was written the
--     permissive way; re-running the roles file afterwards does not go back and tighten it.
--   * a table that is missing entirely reads as "empty", not as "missing", because an anonymous
--     or unpolicied read returns an empty list rather than an error.
--
-- Run it in the SQL editor. Four sections; read them in order.

-- =============================================================== 1. is the table even there?
with needed(t) as (values
  ('club_state'),('attendance_marks'),('plan_sessions'),('fitness_sessions'),('squad_plans'),
  ('season_plans'),('fitness_plans'),('family_accounts'),('staff_accounts'),('swimmer_docs'),
  ('push_subscriptions'),('announcements'),('family_messages'),('lounge_posts'),('lounge_comments'),
  ('signup_alerts'),('vx_squads_t'),('vx_video_analyses'),('audit_log'),('vx_staff_emails'),
  ('invoices'),('memberships'),('inbody_readings'),('hr_sets')
)
select n.t as table_name,
       case when c.oid is null then '✗ MISSING' else '✓' end as exists,
       case when c.oid is null then null when c.relrowsecurity then 'on' else '✗ RLS OFF' end as rls
  from needed n
  left join pg_class c on c.relname = n.t and c.relnamespace = 'public'::regnamespace
 order by (c.oid is null) desc, n.t;

-- ================================================ 2. the columns the app sends, one table each
-- If a column the app writes is absent, that write is refused with a 400 and the app falls back
-- to the copy on the device. fitness_plans is the one that bit this club.
with want(t, col) as (values
  ('fitness_plans','plan'),('fitness_plans','ts'),('fitness_plans','updated_at'),
  ('squad_plans','plan'),('squad_plans','ts'),('squad_plans','updated_at'),
  ('season_plans','season'),('season_plans','ts'),('season_plans','updated_at'),
  ('vx_squads_t','sort'),('vx_squads_t','accent'),('vx_squads_t','updated_at'),
  ('vx_video_analyses','kicks'),('vx_video_analyses','swimmers'),('vx_video_analyses','stroke'),
  ('family_accounts','swimmer_ids'),('family_accounts','pass'),('family_accounts','role'),
  ('audit_log','actor'),('audit_log','action'),('audit_log','detail'),('audit_log','at'),
  ('club_state','key'),('club_state','value'),('club_state','updated_at')
)
select w.t as table_name, w.col as column_name,
       case when a.attname is null then '✗ MISSING — writes to this table fail' else '✓' end as status
  from want w
  left join pg_attribute a
         on a.attrelid = to_regclass('public.'||w.t)
        and a.attname  = w.col
        and a.attnum > 0 and not a.attisdropped
 order by (a.attname is null) desc, w.t, w.col;

-- ===================================================== 3. who can write, in plain words
-- `anon` means anyone who opens the site, signed in or not — the anon key is in the page source.
-- Nothing that holds a child's data should say anon here.
select tablename as table_name, policyname, cmd,
       array_to_string(roles, ',') as granted_to,
       case
         when 'anon' = any(roles) and cmd <> 'SELECT' then '‼ ANYONE CAN WRITE'
         when 'anon' = any(roles)                     then '⚠ anyone can read'
         when coalesce(qual::text,'') like '%vx_is_staff%'
           or coalesce(with_check::text,'') like '%vx_is_staff%' then '✓ staff only'
         else 'signed-in'
       end as verdict
  from pg_policies
 where schemaname = 'public'
 order by (('anon' = any(roles))::int) desc, tablename, cmd;

-- =============================================== 4. tables with RLS on and no policy at all
-- With RLS enabled and no policy for a command, that command is refused for everybody — which
-- is correct for audit_log's update and delete, and a silent outage anywhere else.
select c.relname as table_name, 'RLS on, NO policies — every read and write refused' as warning
  from pg_class c
 where c.relnamespace = 'public'::regnamespace
   and c.relkind = 'r' and c.relrowsecurity
   and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname)
 order by 1;

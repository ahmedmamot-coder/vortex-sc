-- Who did what, and when.
--
-- A club holding 304 children's records needs to be able to answer "who changed this, and when"
-- — for a safeguarding question, a billing dispute, or a coach saying a plan was not theirs.
-- Until now nothing in the app could answer any of those.
--
-- Three properties make this an audit log rather than a list of events:
--
-- 1. APPEND-ONLY. There is an insert policy and a read policy and deliberately no update or
--    delete policy at all. A log that the people it records can edit is not evidence of
--    anything. Even the managers cannot rewrite it from the app; removing a row needs the
--    service role or the SQL editor, which is itself a deliberate act rather than a tap.
-- 2. THE SERVER STAMPS THE TIME. `at` defaults to now() and the app never sends one. Device
--    clocks are wrong often enough to matter — a phone whose clock had drifted is what broke
--    an authenticator code earlier this week — and a timeline assembled from twelve phones'
--    opinions of the time is not a timeline.
-- 3. IT RECORDS WHAT CHANGED, NOT THE CONTENTS. "saved a session for Vortex B, 6,700 m" and
--    not the plan; "uploaded a medical certificate" and not the certificate. An audit log is
--    read by more people than the thing it describes, so copying children's data into it would
--    widen the exposure rather than narrow it.
--
-- Run this in the Supabase SQL editor.

create table if not exists audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),   -- the server's clock, never the phone's
  actor       text,                                 -- email, the one identity both sides share
  actor_name  text,                                 -- as shown in the app, for reading at a glance
  actor_role  text,                                 -- 'Head Coach', 'parent', …
  action      text not null,                        -- 'sign-in', 'plan.save', 'invoice.paid', …
  target      text,                                 -- what it happened to, in words
  detail      jsonb not null default '{}'::jsonb,   -- small facts: squad, metres, amount
  ua          text                                  -- which kind of device, for telling two sessions apart
);

create index if not exists audit_log_at     on audit_log (at desc);
create index if not exists audit_log_actor  on audit_log (actor, at desc);
create index if not exists audit_log_action on audit_log (action, at desc);

alter table audit_log enable row level security;

-- Anyone signed in may add to it — a parent's sign-in has to be recordable, and the app cannot
-- know whether the person is staff before it writes the row.
drop policy if exists audit_log_append on audit_log;
create policy audit_log_append on audit_log
  for insert to authenticated with check (true);

-- Reading it is staff-only: it names who did what and when, which is not a parent's business.
-- vx_is_staff() comes from security_4_roles.sql; until that has been run the function does not
-- exist, so this falls back to any signed-in user and says so.
do $$
begin
  drop policy if exists audit_log_read on audit_log;
  if exists (select 1 from pg_proc where proname = 'vx_is_staff') then
    create policy audit_log_read on audit_log for select to authenticated using (vx_is_staff());
    raise notice 'vx: audit log readable by staff only';
  else
    create policy audit_log_read on audit_log for select to authenticated using (true);
    raise notice 'vx: audit log readable by ANY signed-in user — run security_4_roles.sql to narrow it to staff';
  end if;
end $$;

-- No update policy and no delete policy, on purpose. With RLS enabled and no policy for a
-- command, that command is refused for everybody. That is the whole point.

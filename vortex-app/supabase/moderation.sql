-- ============================================================================
--  VORTEX SC — reporting, blocking and the moderation queue.
--
--  WHY: the app has a club feed (posts, images, comments) and private family<->coach
--  messages, and no way to report any of it or to block anybody. App Store Review
--  Guideline 1.2 requires all four of: a filter for objectionable content, a way to
--  report it, a way to block abusive users, and published contact details. It is also
--  the single most common rejection for an app shaped like this one — and the members
--  here are children, which is the actual reason to do it.
--
--  Two tables:
--    content_reports — one row per report, with enough of the content copied in that a
--                      manager can judge it after the original has been deleted.
--    member_blocks   — one row per (blocker, blocked) pair. Blocking is one-directional
--                      and private: the blocked person is never told.
--
--  Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
-- ============================================================================

-- ------------------------------------------------------------------ 0. staff test
-- Wrapped so the policies below read the same whether or not security_4_roles.sql has
-- been run yet. Without it, staff-only reads are closed rather than open — the opposite
-- of what happened to vx_squads_t, which was seeded while its policy was still the
-- permissive branch and stayed that way.
create or replace function public.staff_check() returns boolean
language plpgsql stable security definer set search_path = public as $fn$
begin
  if to_regproc('public.vx_is_staff') is null then return false; end if;
  return public.vx_is_staff();
end $fn$;

-- ------------------------------------------------------------------ 1. tables
create table if not exists public.content_reports (
  id            text primary key,
  kind          text not null,            -- 'post' | 'comment' | 'message'
  target_id     text not null,
  target_author text,                     -- who wrote it, as the app shows them
  excerpt       text,                     -- a copy, because the original may be deleted
  reason        text not null,            -- 'child-safety' | 'abuse' | 'sexual' | 'spam' | 'other'
  detail        text,
  by_label      text,                     -- who reported it
  by_email      text,
  status        text not null default 'open',   -- 'open' | 'actioned' | 'dismissed'
  resolved_by   text,
  resolved_note text,
  resolved_at   timestamptz,
  ts            bigint,
  created_at    timestamptz not null default now()
);
create index if not exists reports_status_idx on public.content_reports (status, created_at desc);
create index if not exists reports_target_idx on public.content_reports (target_id);

create table if not exists public.member_blocks (
  id         text primary key,            -- blocker || '::' || blocked
  blocker    text not null,
  blocked    text not null,
  ts         bigint,
  created_at timestamptz not null default now()
);
create index if not exists blocks_blocker_idx on public.member_blocks (blocker);

-- ------------------------------------------------------------------ 2. policies
do $$
declare p text; t text;
begin
  foreach t in array array['content_reports','member_blocks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    for p in select policyname from pg_policies
             where schemaname='public' and tablename=t loop
      execute format('drop policy if exists %I on public.%I', p, t);
    end loop;
  end loop;
end $$;

-- Anyone signed in may file a report, because anybody may be the one who sees the thing
-- that needs reporting. Nobody may edit or delete one afterwards except staff: a report
-- its own subject could quietly withdraw is not a report.
create policy reports_insert on public.content_reports
  for insert to authenticated with check (true);
create policy reports_read on public.content_reports
  for select to authenticated using (public.staff_check());
create policy reports_update on public.content_reports
  for update to authenticated using (public.staff_check()) with check (public.staff_check());
create policy reports_delete on public.content_reports
  for delete to authenticated using (public.staff_check());

-- A block list is the blocker's own. Staff can read all of them, because "who has blocked
-- whom" is evidence when a report is judged — but staff cannot write into someone's list.
create policy blocks_read on public.member_blocks
  for select to authenticated
  using (blocker = coalesce(auth.jwt() ->> 'email', '') or public.staff_check());
create policy blocks_insert on public.member_blocks
  for insert to authenticated
  with check (blocker = coalesce(auth.jwt() ->> 'email', ''));
create policy blocks_delete on public.member_blocks
  for delete to authenticated
  using (blocker = coalesce(auth.jwt() ->> 'email', ''));

notify pgrst, 'reload schema';

do $$
begin
  if to_regproc('public.vx_is_staff') is null then
    raise notice 'NOTE: vx_is_staff() does not exist yet, so the moderation queue is readable by NOBODY. Run security_4_roles.sql, then run this file again.';
  else
    raise notice 'moderation ready: reports filed by any member, read and resolved by staff';
  end if;
end $$;

-- Check it:
--   select tablename, policyname, cmd, roles from pg_policies
--   where schemaname='public' and tablename in ('content_reports','member_blocks')
--   order by tablename, cmd;

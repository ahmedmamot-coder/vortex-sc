-- ============================================================================
--  VORTEX SC — SECURITY STEP 1: define who the admins are.
--  Admins (you + Sameh) get FULL access to everything after the lockdown.
--  Recognised by the email on their Supabase Auth account.
--  Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
-- ============================================================================
create table if not exists public.admins (
  email      text primary key,
  added_at   timestamptz not null default now()
);

-- >>> EDIT these two if the emails differ (must match the emails the app signs in with) <<<
insert into public.admins(email) values
  ('ahmedmamot@gmail.com'),
  ('sameh@vortexswimmingclub.com')
on conflict (email) do nothing;

alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

-- is_admin(): true when the signed-in user's email is in the admins table.
-- SECURITY DEFINER so it can read the (locked) admins table regardless of caller.
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where a.email = (auth.jwt() ->> 'email'));
$$;
grant execute on function public.is_admin() to anon, authenticated;

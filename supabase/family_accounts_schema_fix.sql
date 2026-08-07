-- ============================================================================
--  VORTEX SC — FIX: family_accounts is missing columns, so every save failed.
--
--  Supabase reported:  column family_accounts.name does not exist   (code 42703)
--
--  The live table was created without the columns the app writes, so EVERY attempt
--  to save a parent — at registration, at sign-in, and from the admin screen — was
--  rejected with a 400. That, not the security rules, is why the admin kept seeing
--  0 family accounts even though 5 people had genuinely registered.
--
--  This adds any missing column without touching data that is already there, then
--  tells the API layer to reload its cached view of the table.
--
--  Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
-- ============================================================================

create table if not exists public.family_accounts (
  id text primary key
);

alter table public.family_accounts add column if not exists name        text;
alter table public.family_accounts add column if not exists email       text;
alter table public.family_accounts add column if not exists phone       text;
alter table public.family_accounts add column if not exists pass        text;
alter table public.family_accounts add column if not exists role        text;
alter table public.family_accounts add column if not exists swimmer_ids jsonb;
alter table public.family_accounts add column if not exists ts          bigint;
alter table public.family_accounts add column if not exists created_at  timestamptz not null default now();

create index if not exists family_accounts_email_idx on public.family_accounts (email);

-- Registration happens before sign-in, so INSERT must be open to anon; changing or
-- deleting an account stays signed-in only. (Same as family_register_fix.sql.)
alter table public.family_accounts enable row level security;
grant select, insert, update, delete on public.family_accounts to anon, authenticated;
do $$
declare p text;
begin
  for p in select policyname from pg_policies
           where schemaname='public' and tablename='family_accounts' loop
    execute format('drop policy if exists %I on public.family_accounts', p);
  end loop;
  create policy fam_reg_insert on public.family_accounts for insert to anon, authenticated with check (true);
  create policy lk_select      on public.family_accounts for select to anon, authenticated using (true);
  create policy lk_update      on public.family_accounts for update to authenticated using (true) with check (true);
  create policy lk_delete      on public.family_accounts for delete to authenticated using (true);
end $$;

-- The API layer caches the table shape; without this it can keep reporting the old one.
notify pgrst, 'reload schema';

-- Check it:
--   select column_name, data_type from information_schema.columns
--   where table_schema='public' and table_name='family_accounts' order by ordinal_position;

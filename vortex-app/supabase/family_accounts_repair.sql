-- family_accounts: make the table accept what the app actually writes.
--
-- A red banner reading "family_accounts · HTTP 400" means the database rejected the SHAPE of
-- the write, not the permission. 400 comes back for a column that does not exist (42703), a
-- NOT NULL column the app never sends (23502), or a value the column will not take — an id of
-- 'fam1a2b3c_x9' against a uuid column (22P02). None of those are fixed by trying again, which
-- is exactly what the app used to do, every 45 seconds, for as long as it stayed open.
--
-- This table has been rebuilt to a different design than the app writes at least twice. Every
-- statement here is idempotent and none of them delete anything.
--
-- IT DELIBERATELY DOES NOT TOUCH POLICIES. The two earlier repair scripts recreated the
-- wide-open anon policies as part of the fix; running one of those now would quietly undo the
-- Stage 4 lockdown and put 304 children's records back on the public internet. Permissions are
-- security_4_roles.sql's job and nothing else's.
--
-- Run it in the Supabase SQL editor. Safe to re-run.

-- The app writes: id, name, email, phone, pass, role, swimmer_ids, ts.
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

-- The app generates text ids ('fam1a2b3c_x9'). A uuid column rejects every one of them, and an
-- Auth uuid is still perfectly valid text, so widening loses nothing.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='family_accounts'
                and column_name='id' and data_type <> 'text') then
    alter table public.family_accounts alter column id type text using id::text;
    raise notice 'vx: family_accounts.id widened to text';
  end if;
end $$;

alter table public.family_accounts alter column created_at set default now();
update public.family_accounts set created_at = now() where created_at is null;

-- Any column that is NOT NULL, has no default, and is not one the app sends will reject every
-- single write. Rather than guess at the names, find them and say so — and fill in the one this
-- table is known to carry.
do $$
declare c record; n int := 0;
begin
  for c in
    select column_name from information_schema.columns
     where table_schema='public' and table_name='family_accounts'
       and is_nullable='NO' and column_default is null
       and column_name not in ('id','name','email','phone','pass','role','swimmer_ids','ts','created_at')
  loop
    n := n + 1;
    raise notice 'vx: family_accounts.% is required but the app never sends it — every save will be rejected', c.column_name;
  end loop;
  if n = 0 then
    raise notice 'vx: no required column is left unfilled';
  end if;
end $$;

-- full_name is the one this table has carried before. Keep it, stop it being required, and let
-- it fill itself from name so anything still reading it keeps working.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='family_accounts' and column_name='full_name') then
    alter table public.family_accounts alter column full_name drop not null;
    update public.family_accounts set full_name = coalesce(full_name, name, split_part(coalesce(email,''),'@',1));

    create or replace function public.family_accounts_fill_full_name()
    returns trigger language plpgsql as $fn$
    begin
      if new.full_name is null or new.full_name = '' then
        new.full_name := coalesce(new.name, split_part(coalesce(new.email,''), '@', 1), 'Family');
      end if;
      if new.name is null or new.name = '' then
        new.name := new.full_name;
      end if;
      return new;
    end $fn$;

    drop trigger if exists family_accounts_fill_full_name_trg on public.family_accounts;
    create trigger family_accounts_fill_full_name_trg
      before insert or update on public.family_accounts
      for each row execute function public.family_accounts_fill_full_name();
    raise notice 'vx: full_name is optional and fills itself';
  end if;
end $$;

create index if not exists family_accounts_email_idx on public.family_accounts (email);

-- PostgREST caches the table's shape. Without this it can keep rejecting writes against a
-- version of the table that no longer exists.
notify pgrst, 'reload schema';

-- Check it:
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema='public' and table_name='family_accounts'
--   order by ordinal_position;

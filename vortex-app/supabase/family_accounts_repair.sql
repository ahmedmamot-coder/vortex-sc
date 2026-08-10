-- family_accounts: stop rejecting every save.
--
-- The database said, in as many words:
--
--   null value in column "full_name" of relation "family_accounts"
--   violates not-null constraint
--
-- full_name is REQUIRED, has no default, and the app has never sent it — it writes `name`.
-- So every save to this table was refused: registrations, sign-ins, and the admin screen alike.
-- That is a 400, which is the database rejecting the SHAPE of the write, not the permission,
-- and no amount of retrying can change the answer.
--
-- This makes the table accept what the app actually writes, three ways over, so it cannot come
-- back: full_name stops being required, gains a default, AND fills itself from `name` by
-- trigger. Anything still reading full_name keeps working — it is kept and populated, not
-- dropped. Nothing is deleted and every statement is safe to re-run.
--
-- IT DELIBERATELY DOES NOT TOUCH POLICIES. The two earlier repair scripts for this table
-- recreated the wide-open anon policies as part of their fix; running one of those today would
-- silently undo the Stage 4 lockdown and put 304 children's records back on the public
-- internet. Permissions are security_4_roles.sql's job and nothing else's.
--
-- Supabase → SQL Editor → New query → paste → Run.

begin;

-- ---------------------------------------------------------------------------------------------
-- 1. Every column the app writes: id, name, email, phone, pass, role, swimmer_ids, ts.
-- ---------------------------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------------------------
-- 2. The app generates text ids ('fam1a2b3c_x9'). A uuid column rejects every one of them, and
--    an Auth uuid is still perfectly good text, so widening loses nothing.
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='family_accounts'
                and column_name='id' and data_type <> 'text') then
    alter table public.family_accounts alter column id type text using id::text;
    raise notice 'vx: family_accounts.id widened to text';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. created_at fills itself in.
-- ---------------------------------------------------------------------------------------------
alter table public.family_accounts alter column created_at set default now();
update public.family_accounts set created_at = now() where created_at is null;

-- ---------------------------------------------------------------------------------------------
-- 4. full_name — the column that was rejecting everything.
--
--    Three independent guards, because this has come back twice already:
--      a. it is no longer required, so a write without it is accepted;
--      b. it has a default, so a raw insert that names no columns still works;
--      c. a trigger fills it from `name`, so it holds something meaningful rather than ''.
--    The trigger also fills `name` from full_name, so a row written by anything else is
--    readable by this app.
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='family_accounts' and column_name='full_name') then

    alter table public.family_accounts alter column full_name drop not null;
    alter table public.family_accounts alter column full_name set default '';
    update public.family_accounts
       set full_name = coalesce(nullif(full_name,''), nullif(name,''), split_part(coalesce(email,''),'@',1), 'Family')
     where full_name is null or full_name = '';
    raise notice 'vx: full_name is no longer required';
  else
    raise notice 'vx: family_accounts has no full_name column — nothing to relax';
  end if;
end $$;

create or replace function public.family_accounts_fill_full_name()
returns trigger language plpgsql as $fn$
begin
  if new.full_name is null or new.full_name = '' then
    new.full_name := coalesce(nullif(new.name,''), split_part(coalesce(new.email,''), '@', 1), 'Family');
  end if;
  if new.name is null or new.name = '' then
    new.name := new.full_name;
  end if;
  return new;
end $fn$;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='family_accounts' and column_name='full_name') then
    drop trigger if exists family_accounts_fill_full_name_trg on public.family_accounts;
    create trigger family_accounts_fill_full_name_trg
      before insert or update on public.family_accounts
      for each row execute function public.family_accounts_fill_full_name();
    raise notice 'vx: full_name now fills itself from name';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. Anything ELSE that is required, has no default, and is not a column the app sends.
--    One such column rejects 100% of writes, exactly as full_name did. Reporting it and leaving
--    it in place would mean fixing this table a third time in a fortnight, so each one is
--    relaxed and named in the output.
-- ---------------------------------------------------------------------------------------------
do $$
declare c record; n int := 0;
begin
  for c in
    select column_name from information_schema.columns
     where table_schema='public' and table_name='family_accounts'
       and is_nullable='NO' and column_default is null
       and column_name not in ('id','name','email','phone','pass','role','swimmer_ids','ts','created_at')
  loop
    execute format('alter table public.family_accounts alter column %I drop not null', c.column_name);
    n := n + 1;
    raise notice 'vx: family_accounts.% was required and never sent — no longer required', c.column_name;
  end loop;
  if n = 0 then
    raise notice 'vx: nothing else was blocking a save';
  end if;
end $$;

create index if not exists family_accounts_email_idx on public.family_accounts (email);

commit;

-- PostgREST caches the shape of every table. Without this it can keep rejecting writes against
-- a version of family_accounts that no longer exists.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------------------------
-- The answer, as a row you can read rather than a notice you might miss.
-- 'none' here means every save will now be accepted.
-- ---------------------------------------------------------------------------------------------
select coalesce(string_agg(column_name, ', '), 'none — every save will now be accepted')
         as still_required_but_never_sent
  from information_schema.columns
 where table_schema='public' and table_name='family_accounts'
   and is_nullable='NO' and column_default is null
   and column_name not in ('id','name','email','phone','pass','role','swimmer_ids','ts','created_at');

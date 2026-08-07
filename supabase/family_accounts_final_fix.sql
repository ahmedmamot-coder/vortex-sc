-- ============================================================================
--  VORTEX SC — FINAL FIX for family_accounts.
--
--  The live table was built to a different design than the app writes. Three things
--  rejected every save, which is why 5 people registered and the admin saw 0:
--
--   1. full_name   NOT NULL, no default, and the app never sends it  -> 23502
--   2. created_at  NOT NULL, no default                              -> 23502
--   3. id          is uuid, but the app generates text ids like
--                  "fam1a2b3c_x9"                                    -> 22P02
--
--  This makes the table accept what the app actually writes, WITHOUT deleting
--  anything. full_name is kept and auto-filled from name, so nothing that relies
--  on it breaks.
--
--  Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
-- ============================================================================

-- 1. id: accept the app's text ids (Auth UUIDs are still valid text)
alter table public.family_accounts alter column id type text using id::text;

-- 2. created_at: fill itself in
alter table public.family_accounts alter column created_at set default now();
update public.family_accounts set created_at = now() where created_at is null;

-- 3. full_name: no longer required, and mirrors name automatically
alter table public.family_accounts alter column full_name drop not null;
update public.family_accounts set full_name = coalesce(full_name, name, split_part(email,'@',1));

create or replace function public.family_accounts_fill_full_name()
returns trigger language plpgsql as $$
begin
  if new.full_name is null or new.full_name = '' then
    new.full_name := coalesce(new.name, split_part(coalesce(new.email,''), '@', 1), 'Family');
  end if;
  if new.name is null or new.name = '' then
    new.name := new.full_name;
  end if;
  return new;
end $$;

drop trigger if exists family_accounts_fill_full_name_trg on public.family_accounts;
create trigger family_accounts_fill_full_name_trg
  before insert or update on public.family_accounts
  for each row execute function public.family_accounts_fill_full_name();

-- 4. role / email are NOT NULL and the app does send both — nothing to change.

-- 5. The API caches the table shape; without this it can keep rejecting inserts.
notify pgrst, 'reload schema';

-- Check it:
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema='public' and table_name='family_accounts'
--   order by ordinal_position;

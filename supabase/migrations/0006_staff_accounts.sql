-- Staff accounts & per-account edits: one row per account (like the chat & plans),
-- so adding/editing staff on different devices never overwrites each other.
-- Holds both added staff (is_custom = true) and edits to the built-in accounts
-- (Ahmed, Sameh, the 9 coaches) keyed by their account id.

create table if not exists public.staff_accounts (
  id         text primary key,
  name       text,
  username   text,
  pin        text,
  role       text,
  squad_id   text,
  phone      text,
  email      text,
  bio        text,
  photo      text,
  is_custom  boolean default false,
  ts         bigint,
  created_at timestamptz not null default now()
);

alter table public.staff_accounts enable row level security;

grant select, insert, update, delete on public.staff_accounts to anon, authenticated;

drop policy if exists staff_accounts_read   on public.staff_accounts;
drop policy if exists staff_accounts_insert on public.staff_accounts;
drop policy if exists staff_accounts_update on public.staff_accounts;
drop policy if exists staff_accounts_delete on public.staff_accounts;

create policy staff_accounts_read   on public.staff_accounts for select to anon, authenticated using (true);
create policy staff_accounts_insert on public.staff_accounts for insert to anon, authenticated with check (true);
create policy staff_accounts_update on public.staff_accounts for update to anon, authenticated using (true) with check (true);
create policy staff_accounts_delete on public.staff_accounts for delete to anon, authenticated using (true);

-- Parent/swimmer accounts: one row per family login (like chat, plans, staff),
-- so simultaneous registrations on different devices never overwrite each other.

create table if not exists public.family_accounts (
  id          text primary key,
  name        text,
  email       text,
  phone       text,
  pass        text,
  role        text,
  swimmer_ids jsonb,
  ts          bigint,
  created_at  timestamptz not null default now()
);

create index if not exists family_accounts_email_idx on public.family_accounts (email);

alter table public.family_accounts enable row level security;

grant select, insert, update, delete on public.family_accounts to anon, authenticated;

drop policy if exists family_accounts_read   on public.family_accounts;
drop policy if exists family_accounts_insert on public.family_accounts;
drop policy if exists family_accounts_update on public.family_accounts;

create policy family_accounts_read   on public.family_accounts for select to anon, authenticated using (true);
create policy family_accounts_insert on public.family_accounts for insert to anon, authenticated with check (true);
create policy family_accounts_update on public.family_accounts for update to anon, authenticated using (true) with check (true);

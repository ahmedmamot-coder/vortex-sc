-- ============================================================================
--  VORTEX SC — swimmer_docs : identity/medical documents as their own rows.
--  Documents used to live inside a big synced blob that overflowed the browser
--  storage quota, so saves failed silently. Now each document is one row here,
--  which is reliable and never hits the quota. Safe to re-run.
--  Paste into Supabase -> SQL Editor -> Run.
-- ============================================================================
create table if not exists public.swimmer_docs (
  id          text primary key,          -- '<swimmerId>::<kind>'
  swimmer_id  text,
  kind        text,                      -- 'birth' | 'id' | 'medical'
  url         text,
  name        text,
  type        text,
  uploaded_at text,
  ts          bigint,
  created_at  timestamptz not null default now()
);
create index if not exists swimmer_docs_sw_idx on public.swimmer_docs (swimmer_id);
alter table public.swimmer_docs enable row level security;
grant select, insert, update, delete on public.swimmer_docs to anon, authenticated;
drop policy if exists swimmer_docs_read   on public.swimmer_docs;
drop policy if exists swimmer_docs_insert on public.swimmer_docs;
drop policy if exists swimmer_docs_update on public.swimmer_docs;
drop policy if exists swimmer_docs_delete on public.swimmer_docs;
create policy swimmer_docs_read   on public.swimmer_docs for select to anon, authenticated using (true);
create policy swimmer_docs_insert on public.swimmer_docs for insert to anon, authenticated with check (true);
create policy swimmer_docs_update on public.swimmer_docs for update to anon, authenticated using (true) with check (true);
create policy swimmer_docs_delete on public.swimmer_docs for delete to anon, authenticated using (true);

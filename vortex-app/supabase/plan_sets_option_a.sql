-- Option A plan builder — structured set fields + a reusable "favourites" library.
--
-- The session plan builder writes a set as a single line: reps × distance, a stroke, a zone, some
-- tools, a few focus tags and a note. Three of those had nowhere to live: a coach wanting to
-- reuse "8 × 100 Free" tomorrow retyped it, and "4 × 100" was stuffed into the description text
-- because plan_sets had no reps column. This adds the missing columns and one small table so a
-- set can be starred once and dropped into any squad's plan later.
--
-- `add column if not exists` does nothing to a column already there, and `create table if not
-- exists` / `create index if not exists` are the same — so this is safe on a database that is
-- already correct and safe to run twice. It adds no data to existing rows and changes none.

-- --------------------------------------------------------------------- structured set fields
alter table public.plan_sets
  add column if not exists reps   int   not null default 1,
  add column if not exists stroke text,                              -- Free, Fly, BK, BR, IM, Choice
  add column if not exists focus  text[] not null default '{}';      -- Descend, Build, DPS, …

-- ------------------------------------------------------------------------ favourites library
-- Squad-scoped so a squad's coaches share one shelf of go-to sets, mirroring the one-plan-per-
-- squad model the builder already uses. created_by records who added it; nothing cascades to a
-- plan, because a favourite is a template that gets *copied* into a plan, never linked to one.
create table if not exists public.plan_set_favorites (
  id          uuid primary key default gen_random_uuid(),
  squad_id    uuid not null references public.squads (id) on delete cascade,
  label       text   not null default '',
  reps        int    not null default 1,
  distance    int    not null default 0,
  stroke      text,
  description text   not null default '',
  equipment   text[] not null default '{}',
  set_types   text[] not null default '{}',
  focus       text[] not null default '{}',
  rest        text   default '',
  zone        text,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now()
);

create index if not exists plan_set_favorites_squad_idx
  on public.plan_set_favorites (squad_id, created_at desc);

-- Staff-only, exactly like plan_sets: coaches read and write, families never see it.
alter table public.plan_set_favorites enable row level security;

drop policy if exists plan_set_favorites_select on public.plan_set_favorites;
drop policy if exists plan_set_favorites_write  on public.plan_set_favorites;
create policy plan_set_favorites_select on public.plan_set_favorites
  for select using (is_staff());
create policy plan_set_favorites_write on public.plan_set_favorites
  for all using (is_staff()) with check (is_staff());

notify pgrst, 'reload schema';

-- --------------------------------------------------------------------------------- check it
-- The four columns the builder now writes, and whether they are there. All must say ✓.
with want(t, col) as (values
  ('plan_sets','reps'), ('plan_sets','stroke'), ('plan_sets','focus'),
  ('plan_set_favorites','id')
)
select w.t as table_name, w.col as column_name,
       case when a.attname is null then '✗ STILL MISSING' else '✓' end as status
  from want w
  left join pg_attribute a
         on a.attrelid = to_regclass('public.'||w.t)
        and a.attname = w.col and a.attnum > 0 and not a.attisdropped
 order by (a.attname is null) desc, w.t, w.col;

-- Row-level security has to be ON and both policies present, or the table is either wide open or
-- unusable. Three rows expected: rls = true, and the two policy names.
select 'rls_enabled' as what, (relrowsecurity)::text as value
  from pg_class where oid = to_regclass('public.plan_set_favorites')
union all
select 'policy', polname
  from pg_policy where polrelid = to_regclass('public.plan_set_favorites')
 order by 1, 2;

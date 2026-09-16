-- One plan per squad — stop editing a training from creating a duplicate.
--
-- The Plans editor keeps exactly one plan per squad and reads it with a single-row
-- query. Nothing in the schema enforced that. Two coaches (or one coach on two
-- devices, or two tabs) opening Plans for a squad that had no plan yet each inserted
-- a fresh default plan — a duplicate training. Worse, once two rows existed the
-- single-row read errored on every later visit, so the app fell through to its
-- "no plan, create one" branch and seeded ANOTHER default plan each time the page was
-- opened. That is the "it makes a double every time we edit and save" a coach sees:
-- the edited plan is left behind and a fresh default takes its place, and the count
-- keeps climbing.
--
-- The app read is fixed in the same change to take the most recently updated plan and
-- never re-seed while one exists. This script collapses the duplicates that already
-- exist — keeping the newest plan per squad, whose sections and sets come with it while
-- the discarded plans cascade away — and adds the unique constraint the app always
-- assumed, so a race can never create a second plan again.
--
-- Safe to run twice: after the first run there are no duplicates and the constraint
-- already exists, so both steps are no-ops.

begin;

-- Keep the newest plan per squad (tie-broken by id), delete the rest. plan_sections
-- and plan_sets are ON DELETE CASCADE, so a discarded plan takes its own content with
-- it and nothing is left orphaned. The single top-ranked row per squad is outranked by
-- nothing, so it is never deleted.
delete from public.plans p
using public.plans keep
where p.squad_id = keep.squad_id
  and p.id <> keep.id
  and (keep.updated_at, keep.id) > (p.updated_at, p.id);

alter table public.plans
  drop constraint if exists plans_squad_id_key;
alter table public.plans
  add constraint plans_squad_id_key unique (squad_id);

commit;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------------------------------ check it
-- No squad may have more than one plan now. This must return zero rows.
select squad_id, count(*) as plans
  from public.plans
 group by squad_id
having count(*) > 1;

-- And the unique constraint is in place — one row, contype 'u'.
select conname, contype
  from pg_constraint
 where conrelid = 'public.plans'::regclass
   and conname = 'plans_squad_id_key';

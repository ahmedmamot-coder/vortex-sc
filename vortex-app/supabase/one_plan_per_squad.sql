-- One plan per squad — stop editing a training from creating a duplicate.
--
-- APPLIED to the club's database (project qhrpwiakobgcxfmcoyfg) on 16 Sep 2026 and
-- verified after: 3732 plans across 6 squads collapsed to exactly one plan each, the
-- single edited plan (1602 m) kept, the unique constraint added, no orphaned sections
-- or sets. Kept here as the readable record of what was changed and why. Safe to run
-- again: after the first run there are no duplicates and the constraint already exists,
-- so every step is a no-op.
--
-- The Plans editor keeps exactly one plan per squad and reads it with a single-row
-- query. Nothing in the schema enforced that. Two coaches (or one coach on two devices,
-- or two tabs) opening Plans for a squad that had no plan yet each inserted a fresh
-- default plan — a duplicate training. Worse, once two rows existed the single-row read
-- errored on every later visit, so the app fell through to its "no plan, create one"
-- branch and seeded ANOTHER default plan each time the page was opened — the edited plan
-- left behind, a blank one in its place, the count climbing into the thousands. That is
-- the "it makes a double every time we edit and save" a coach reported.
--
-- The app read is fixed in the same change to take the most recently updated plan and
-- never re-seed while one exists. This script collapses the duplicates that already
-- exist and adds the unique constraint the app always assumed, so a race can never
-- create a second plan again.
--
-- WHICH plan is kept, per squad: the one with real content first (highest total_metres),
-- then the most recently updated, then id. That ordering matters and a plain
-- "newest updated_at" does not: in this club's data a squad had a blank default seed
-- whose updated_at was LATER than its one real, edited plan, so ranking on time alone
-- would have kept the blank and deleted the coach's work.
--
-- The children are deleted explicitly, sets then sections then plans, rather than by
-- leaning on ON DELETE CASCADE. plan_sections.plan_id and plan_sets.section_id are not
-- indexed, so cascading the delete of thousands of plans scans the child tables once per
-- parent row and can run for minutes; the set-based deletes below are one pass each.

begin;

-- Keep, per squad, the best plan: real content first, then newest, then id.
delete from public.plan_sets st
 using public.plan_sections s
 where st.section_id = s.id
   and s.plan_id not in (
     select distinct on (squad_id) id
       from public.plans
      order by squad_id, total_metres desc, updated_at desc, id desc
   );

delete from public.plan_sections s
 where s.plan_id not in (
   select distinct on (squad_id) id
     from public.plans
    order by squad_id, total_metres desc, updated_at desc, id desc
 );

delete from public.plans
 where id not in (
   select distinct on (squad_id) id
     from public.plans
    order by squad_id, total_metres desc, updated_at desc, id desc
 );

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

-- The unique constraint is in place — one row, contype 'u'.
select conname, contype
  from pg_constraint
 where conrelid = 'public.plans'::regclass
   and conname = 'plans_squad_id_key';

-- And nothing was orphaned by the child-first deletes — both counts must be 0.
select
  (select count(*) from public.plan_sections s
     left join public.plans p on p.id = s.plan_id where p.id is null) as orphan_sections,
  (select count(*) from public.plan_sets st
     left join public.plan_sections s on s.id = st.section_id where s.id is null) as orphan_sets;

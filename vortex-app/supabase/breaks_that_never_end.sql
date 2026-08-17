-- Why 191 of 302 swimmers are marked absent on a day nobody took a register.
--
-- A swimmer's status can be Active, or one of Inactive / Traveling / Break / Sick / Injured with
-- a date it runs From and a date it runs To. A status that is not Active makes that swimmer
-- absent, every day, in every register and in every attendance figure the club reports.
--
-- The To date is optional, and a break with no To date never ends. The club set breaks over the
-- summer; the summer is over; those swimmers are still absent and will stay absent for ever.
-- That is what puts club attendance at 37% on a day nobody has marked anybody.
--
-- Section 1 counts them. Section 2 lists the ones that never end, oldest first. Section 3 closes
-- them, and is commented out — read the first two before running anything.
--
-- The names are not here: this table holds swimmer ids, and the names live in the roster. Match
-- them on the Swimmers screen, or use section 2's ids.

-- ============================================================ 1. how many, and of what kind
select coalesce(v->>'reason', '(none given)')                       as reason,
       case when coalesce(v->>'to', '') = '' then '✗ no end date — never ends'
            else '✓ ends ' || (v->>'to') end                        as ends,
       count(*)                                                     as swimmers
  from public.club_state cs
  cross join lateral jsonb_each(
        case when jsonb_typeof(cs.value) = 'object' then cs.value else '{}'::jsonb end) as e(sw, v)
 where cs.key = 'vx_sw_status'
   and jsonb_typeof(v) = 'object'
   and coalesce(v->>'active', 'false') <> 'true'
 group by 1, 2
 order by swimmers desc;

-- ================================================ 2. the ones that never end, oldest first
-- Each of these is a swimmer who is absent from every register from that date until somebody
-- changes it by hand. If the date is months ago, they are almost certainly training.
select e.sw                                     as swimmer_id,
       v->>'reason'                             as reason,
       v->>'from'                               as away_since,
       (current_date - (v->>'from')::date)      as days_so_far
  from public.club_state cs
  cross join lateral jsonb_each(
        case when jsonb_typeof(cs.value) = 'object' then cs.value else '{}'::jsonb end) as e(sw, v)
 where cs.key = 'vx_sw_status'
   and jsonb_typeof(v) = 'object'
   and coalesce(v->>'active', 'false') <> 'true'
   and coalesce(v->>'to', '') = ''
   and coalesce(v->>'from', '') ~ '^\d{4}-\d{2}-\d{2}$'
 order by (v->>'from')::date;

-- ===================================================== 3. end the old ones (COMMENTED OUT)
-- This makes every open-ended status that started more than 30 days ago end yesterday. It does
-- not delete anything: the swimmer's history of being away is kept, it simply stops running
-- into the future, so they count in today's register again.
--
-- Read section 2 first. If somebody genuinely IS away long-term, set their end date on their
-- profile instead and leave this alone — this cannot tell the difference.
--
-- update public.club_state
--    set value = (
--          select jsonb_object_agg(sw, case
--                   when jsonb_typeof(v) = 'object'
--                    and coalesce(v->>'active','false') <> 'true'
--                    and coalesce(v->>'to','') = ''
--                    and coalesce(v->>'from','') ~ '^\d{4}-\d{2}-\d{2}$'
--                    and (v->>'from')::date < current_date - 30
--                   then v || jsonb_build_object('to', to_char(current_date - 1, 'YYYY-MM-DD'))
--                   else v end)
--            from jsonb_each(value) as e(sw, v)),
--        updated_at = now()
--  where key = 'vx_sw_status'
--    and jsonb_typeof(value) = 'object';
--
-- Then run section 1 again: every row should read ✓ ends. The app picks it up on its next sync,
-- so nobody needs to reinstall anything.

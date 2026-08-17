-- Give Mary exactly what Sameh has.
--
-- Both already sign in, and both are already on vx_staff_emails, so the database has always let
-- them write. What differed was the role, and what the app does with it:
--
--   Sameh  "Administrator · full access"
--   Mary   "Admin"
--
-- Under the check that ships now, both mean full access, so this changes nothing about what Mary
-- can do — it makes the two accounts read identically, which is what was asked for and is worth
-- having: two people doing the same job should not be described two different ways in the one
-- place that decides what they can reach.
--
-- Run section 1, then section 2 to see it.

-- ================================================================================ 1. the change
update public.staff_accounts
   set role = 'Administrator · full access'
 where lower(trim(email)) = 'marycrispcleopas@gmail.com';

-- ============================================================================= 2. read it back
-- Both rows must now say the same role, the same email status, and be able to write.
select sa.name,
       sa.role,
       sa.email,
       case when se.email is null then '✗ cannot write' else '✓ can write' end as db_access
  from public.staff_accounts sa
  left join vx_staff_emails se on se.email = lower(trim(sa.email))
 where lower(trim(sa.email)) in ('marycrispcleopas@gmail.com', 'mosame7100@gmail.com')
 order by sa.name;

-- ------------------------------------------------------------------------------------------
-- The five who still cannot write anything, for when you get to them. Each has no email on
-- their staff row, so vx_is_staff() does not recognise them and every save they make is refused
-- — including Coach Mahmoud, who is Head Coach, and Coach Chafik, who takes Senior B's register.
--
-- The fix is their real sign-in address on their staff row; the sync trigger does the rest.
select name, role, '✗ no email on the staff row' as problem
  from public.staff_accounts
 where email is null or trim(email) = ''
 order by name;

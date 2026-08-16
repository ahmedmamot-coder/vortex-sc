-- Why a coach gets "changes have not been saved" on every register mark.
--
-- Every table in this club is protected by vx_is_staff(), which is one line:
--
--     select exists (select 1 from vx_staff_emails where email = vx_email());
--
-- vx_email() is the email inside the sign-in token, lowercased. So a person is staff to this
-- database if, and only if, THE EMAIL THEY SIGN IN WITH is a row in vx_staff_emails. Not their
-- name, not their role in the app, not what the Staff screen says about them. If those two emails
-- differ by so much as a domain, every write they make is refused and the app puts it on the red
-- banner as work the club has lost.
--
-- vx_staff_emails was seeded with three addresses and then everyone who was in staff_accounts at
-- the moment security_4_roles.sql was run. Anyone added after that is covered only by the sync
-- trigger, and only if their staff row carries the same email they sign in with.
--
-- Sections 1–3 read and change nothing. Section 4 grants access and is commented out.

-- ============================================================ 1. who can write, right now
select email as recognised_as_staff from vx_staff_emails order by 1;

-- ================================== 2. everyone who can sign in, and whether writes will work
-- This is the one that answers it. A person listed here as ✗ can sign in perfectly well, see the
-- whole app, mark a register — and have every one of those marks refused.
select u.email                                        as signs_in_with,
       case when s.email is null then '✗ WRITES ARE REFUSED' else '✓ can write' end as status,
       u.last_sign_in_at
  from auth.users u
  left join vx_staff_emails s on s.email = lower(trim(u.email))
 order by (s.email is not null), u.last_sign_in_at desc nulls last;

-- ============================ 3. the staff list in the app, against the emails that can write
-- A row saying "✗ email does not match" is somebody whose staff record carries one address while
-- they sign in with another — the app shows them as staff and the database does not.
do $$
begin
  if to_regclass('public.staff_accounts') is null then
    raise notice 'no staff_accounts table here — section 3 skipped';
  end if;
end $$;

select sa.name,
       sa.email                                       as email_on_their_staff_row,
       case when sa.email is null or trim(sa.email) = '' then '✗ no email on the row at all'
            when se.email is null                          then '✗ not on the staff list'
            else '✓' end                              as status,
       case when au.id is null then '— never signed in with this address' else '' end as note
  from public.staff_accounts sa
  left join vx_staff_emails se on se.email = lower(trim(sa.email))
  left join auth.users au      on lower(trim(au.email)) = lower(trim(sa.email))
 order by (se.email is not null), sa.name;

-- ================================================================= 4. give somebody access
-- Read section 2 first. Every address added here can write to every table in the club — the
-- roster, attendance, every family's record — so add the people who should have that and nobody
-- else. Use the address from the `signs_in_with` column, exactly as it appears there.
--
-- Remove the /* */ and put the real addresses in.

/*
insert into vx_staff_emails (email) values
  (lower(trim('marycrispcleopas@gmail.com'))),
  (lower(trim('sameh4142@gmail.com')))
on conflict (email) do nothing;

-- Then run section 2 again. Every name that should be able to work must say ✓ can write.
*/

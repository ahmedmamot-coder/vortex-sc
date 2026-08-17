-- Why Supabase says "Unable to validate email address: invalid format" about an address that
-- looks perfectly ordinary.
--
-- Two coaches could not be given a password at all:
--
--     could not create "redazizo29@gmail.com": Unable to validate email address: invalid format
--     could not create "samer_alawad@hotmail.com": Unable to validate email address: invalid format
--
-- Both addresses are correct as written. Both belong to people typing on an Arabic keyboard, and
-- a right-to-left mark (U+200F), a zero-width space (U+200B) or a byte-order mark (U+FEFF) rides
-- along with a paste and is invisible everywhere it is ever shown: in the field, in the staff
-- list, in the error message, and in the JSON the error is built from. Auth reads the bytes, not
-- what the address looks like, so it refuses it — correctly, and unanswerably.
--
-- Section 1 shows the bytes. If a row comes back marked ✗, that is the whole answer.
-- Section 2 removes the invisible characters. It is commented out: read the report first.
-- Section 3 is the same question asked of the family accounts, because it is the same paste.
--
-- The app strips these before it sends an address now, and before it saves one. This file is for
-- the addresses already stored, which were saved before it did.

-- ============================================================== 1. what is actually in the row
select sa.name,
       sa.email,
       length(sa.email)                                as characters,
       octet_length(sa.email)                          as bytes,
       case when sa.email ~ '[^\x20-\x7E]'
            then '✗ has a character that is not plain ASCII — this is why Auth refuses it'
            else '✓ plain' end                         as verdict,
       -- The bytes themselves, for the ✗ rows. e2808f is U+200F, e2808b is U+200B,
       -- efbbbf is U+FEFF, c2a0 is a non-breaking space.
       case when sa.email ~ '[^\x20-\x7E]'
            then encode(convert_to(sa.email, 'UTF8'), 'hex')
            else '' end                                as raw_bytes
  from public.staff_accounts sa
 where sa.email is not null and btrim(sa.email) <> ''
 order by (sa.email ~ '[^\x20-\x7E]') desc, sa.name;

-- ================================================================= 2. take them out (COMMENTED)
-- Only these code points, and only the ones that carry no meaning inside an email address:
-- control codes, the non-breaking space, zero-width spaces and joiners, the direction marks and
-- isolates, and the byte-order mark. A Cyrillic "а" is deliberately NOT in this list — it looks
-- identical to a Latin one but it might genuinely be part of somebody's address, so it is
-- reported in section 1 and left for a person to decide.
--
-- Uncomment, run, then run section 1 again: every row should read ✓ plain.
--
-- update public.staff_accounts
--    set email = lower(btrim(regexp_replace(
--          email,
--          E'[\u0001-\u001F\u007F-\u009F\u00A0\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]',
--          '', 'g')))
--  where email ~ '[^\x20-\x7E]';
--
-- The trigger keeps vx_staff_emails in step, so their write access follows the corrected address
-- on its own. What does NOT follow is the Auth user: if one was created on the broken address it
-- stays on the broken address, so set the password again from the app afterwards.

-- ================================================== 3. the same question, for family accounts
-- Same paste, same phones, same failure — a parent who cannot be signed up at all.
select fa.full_name,
       fa.email,
       case when fa.email ~ '[^\x20-\x7E]'
            then '✗ has a character that is not plain ASCII'
            else '✓ plain' end as verdict
  from public.family_accounts fa
 where fa.email is not null and btrim(fa.email) <> ''
   and fa.email ~ '[^\x20-\x7E]'
 order by fa.full_name;

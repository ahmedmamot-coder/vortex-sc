# Vortex SC — security lockdown runbook

Goal: stop anyone with the public key from modifying/deleting club data or reading
minors' sensitive data, while **you (Ahmed) and Sameh keep full access to everything**
and coaches/families keep working.

## How it works
- The app already signs staff into Supabase Auth on login (`_staffAuthEnsure`) using their
  **email + a password derived from their PIN**. Emails are now set for all staff.
- After lockdown, **only signed-in users** can write/delete; **admins** (emails in the
  `admins` table) get everything; sensitive reads require sign-in.

## Do this IN ORDER (do not skip)

1. **Deploy the app** (already pushed) so every staff account has an email.

2. **Supabase → Authentication → Providers → Email → turn OFF "Confirm email".**
   (So staff auto-provision without needing to click an email link. You can turn it back on
   later once accounts exist.)

3. **Log in on the live site as EACH staff member once** (Ahmed, Sameh, every coach).
   This creates their Supabase Auth account behind the scenes.
   - Verify it worked: as Ahmed, open **Settings → Data check → Run data check**. The top row
     **"Secure cloud sign-in"** must show **✓ your email**. If it says "not signed in", stop —
     the lockdown would lock you out. (Usually means confirm-email is still ON.)

4. **Run `security_1_admins.sql`** (edit the two emails first if needed).

5. **(Recommended) Test on a staging DB / preview first** — see DEVELOPMENT.md.

6. **Run `security_2_lockdown.sql`.**

7. **Verify** as Ahmed: add/edit a swimmer, save a plan, take attendance, open documents.
   Everything should still work. Then check a family login still sees their child.

8. **If anything is broken → run `security_3_rollback.sql`** (instant undo, one script).

## What stays open (Tier 1, on purpose)
- Reads of `club_state`, `family_accounts`, `staff_accounts` remain open to the public key,
  because the app needs them **before** a user logs in (app boot + the login screen).
- Phase 2 (later): refactor the login to fetch `family_accounts` **after** authenticating,
  then lock those reads too. That needs app changes + a re-test, so it's deliberately separate.

## Never touched
- `wearable_connections` (WHOOP/Fitbit OAuth tokens) stays **server-only** (service role) — the
  lockdown scripts skip it so tokens are never exposed to logged-in users.

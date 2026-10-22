# Vortex SC — club edition

This is the full Vortex SC app — every screen and tool the club uses — with **no data in it**.
No swimmers, results, meets, staff, photos or accounts come with it. You connect it to your
own Supabase database and start with an empty club: the nine squads (Pre-Team → Legend), no
one in them.

What you need: a free [Supabase](https://supabase.com) project, a free
[Vercel](https://vercel.com) account (or any host that runs Next.js), and Node 20+.

---

## 1. Create your database

1. Supabase → **New project**.
2. Open these three files and change `admin@example.com` and `admin2@example.com` to the
   emails of your two club administrators:
   - `supabase/security_1_admins.sql`
   - `vortex-app/supabase/security_4_roles.sql`
   - `vortex-app/supabase/staff_access_repair.sql`
3. In the project's **SQL Editor**, run these files **one at a time, in this order**:

   **a. The tables**
   - `supabase/all_tables.sql`
   - `supabase/family_accounts_final_fix.sql`
   - `supabase/run_all_pending.sql`
   - `supabase/announcements.sql`
   - `supabase/attendance.sql`
   - `supabase/swimmer_docs.sql`
   - `supabase/wearable_readings.sql`
   - `supabase/wearable_connections.sql`
   - `supabase/push.sql`
   - `supabase/storage_bucket.sql`
   - `vortex-app/supabase/memberships_and_entries.sql`
   - `vortex-app/supabase/invoices.sql`
   - `vortex-app/supabase/inbody_readings.sql`
   - `vortex-app/supabase/media_private.sql`
   - `vortex-app/supabase/swimmer_status.sql`
   - `vortex-app/supabase/swimmer_sponsors.sql`

   **b. Who counts as staff — before anything in (c)**
   - `supabase/security_1_admins.sql`
   - `vortex-app/supabase/security_4_roles.sql`
   - `vortex-app/supabase/staff_access_repair.sql`

   **c. Tables that depend on (b)**
   - `vortex-app/supabase/squads.sql`
   - `vortex-app/supabase/video_analyses.sql`
   - `vortex-app/supabase/audit_log.sql`
   - `vortex-app/supabase/club_meets.sql`
   - `vortex-app/supabase/push_apns.sql`
   - `vortex-app/supabase/family_swimmer_docs.sql`

   After (c), check the **Messages** tab: each file should say the table is
   "writable by staff". If one says "writable by ANY signed-in user", run (b) again and then
   that file again.

   **d. Lock it down — once the app is online and you can sign in (part 4 below)**
   - `supabase/security_2_lockdown.sql`
   - `supabase/stage_c_lockdown.sql`
   - `supabase/security_5_swimmer_docs.sql`
   - `supabase/security_family_read_lockdown.sql`
   - `vortex-app/supabase/club_state_staff_only.sql`

   Do (d). Without it, some tables are open to anyone who has the public key.

4. **Authentication → Users → Add user** for each of your two administrators, with the same
   emails you put in step 2 and a password.

## 2. Point the app at your database

1. `vortex-app/public/assets/club-config.js` — fill in your Supabase URL and **anon** key, the
   two admin emails, and your domain.
2. Copy `vortex-app/.env.local.example` to `vortex-app/.env.local` and fill in at least the
   three Supabase values and `APP_URL`. Everything under "Optional" can stay empty.

## 3. Run it

```bash
cd vortex-app
npm install
npm run dev      # http://localhost:3000
```

Sign in with one of your administrator emails. Add your coaches, swimmers and meets from
inside the app (Club Administration), or import a Hy-Tek / SwimCloud roster.

## 4. Put it online

Push the folder to your own GitHub repository and import it in Vercel with
**Root Directory = `vortex-app`**. Add the same environment variables from `.env.local` in
Vercel → Settings → Environment Variables.

---

## Before parents use it

- **Legal pages** — `vortex-app/public/privacy.html`, `terms.html`, `consent.html` and
  `support.html` describe *Vortex Swimming Club*, its venue and its contact address.
  Replace the venue and `@example.com` addresses with your club's, and have them checked for
  your country.
- **Contact addresses** — every club address in the app is now `…@example.com`
  (privacy, safeguarding). Search the project for `example.com` and replace it with your own.
- **iOS app** (optional) — `ios/` builds the native app. Change the bundle id
  `com.example.vortex` and the `example.com` hostname in `ios/capacitor.config.json` and
  `ios/App/App/Info.plist` to your own; see `ios/README.md`.

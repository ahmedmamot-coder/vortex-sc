# Vortex SC — development, staging & roadmap

## Staging / preview (test before it hits the live club)

The safe way to change the app without risking the live site at vortexswimmingclub.com:

1. **Every branch gets a free Vercel Preview URL.** Instead of committing to `main`, push to a branch:
   ```
   git checkout -b feature/my-change
   git push -u origin feature/my-change
   ```
   Vercel builds a unique preview link (e.g. `vortex-sc-git-feature-my-change.vercel.app`). Test there.
2. **Only merge to `main` when it works.** `main` auto-deploys to the live domain.
3. **Optional separate Supabase project for staging** so test data never touches real swimmers:
   create a second Supabase project, run all the SQL files in `/supabase` there, and set the
   preview environment's `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` to the staging project
   (Vercel → Settings → Environment Variables → *Preview* scope only).

Rule of thumb: **schema/RLS/security changes → always test on a preview + staging DB first.**

## Backups

- **Supabase's own daily backups**: enable in Supabase → Database → Backups (Pro plan keeps 7 days;
  free plan is best-effort — upgrading is worth it for a club holding minors' data).
- **App-level JSON snapshot**: `GET /api/backup/export` dumps every important table to the private
  `vx-backups` Storage bucket. A Vercel cron runs it daily at 03:00 (see `vercel.json`).
  - Manual download now: `/api/backup/export?download=1&key=<BACKUP_SECRET>`
  - Needs `SUPABASE_SERVICE_ROLE_KEY` and (recommended) `BACKUP_SECRET` env vars, plus
    running `supabase/backup_bucket.sql`.

## Calendar feed

- `GET /api/meets/ics` is a live iCal feed of club meets. Families **Subscribe** to
  `https://vortexswimmingclub.com/api/meets/ics` in Google/Apple Calendar and meets appear
  automatically and stay updated.

## Roadmap status (the 10-item plan)

| # | Item | Status |
|---|------|--------|
| 1 | Age-adjusted HR max alert (207 − 0.7×age) | ✅ shipped |
| 2 | Automated backups (daily route + private bucket + cron) | ✅ shipped (run SQL + set env) |
| 3 | Staging / preview flow | ✅ documented (this file) |
| 4 | Coach "Today" dashboard (attendance · red recovery · next meet) | ✅ shipped |
| 10 | Calendar sync (meets → ICS feed) | ✅ shipped |
| 7 | Wellness / hydration daily check-ins | ⏳ next |
| 5 | Meet declarations end-to-end (family submit → coach approve → Hy-Tek) | ⏳ next (event requests exist; needs approval list + export) |
| 8 | Progress analytics (PB progression, squad benchmarks, taper) | ⏳ next |
| 9 | Arabic / multi-language (RTL) | ⏳ next (needs i18n string extraction) |
| 6 | Break the single file into modules | ⏳ ongoing (biggest effort; do incrementally) |

## Notes on the two biggest efforts

- **Security lockdown (P0)** and **modularization** are the two changes that most reduce risk.
  Both should be done on a **preview + staging DB** first, with a rollback SQL ready — never
  directly against the live club.
- Modularization can be incremental: start by moving the SQL and route helpers (done), then
  extract the storage shim, then split the giant render object from the class methods.

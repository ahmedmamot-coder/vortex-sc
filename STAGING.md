# Staging — test changes before your club sees them

Until now every change went straight to the live app, so the first person to find a
bug was a coach or a parent. This gives you a place to try things first.

You already have staging — Vercel builds **every branch** automatically. It just needs
to be used, and pointed at a database that isn't the real one.

---

## How it works

| | Production | Staging |
|---|---|---|
| Branch | `main` | `staging` |
| URL | vortexswimmingclub.com | the preview URL Vercel gives the branch |
| Database | the real Supabase project | a **separate** Supabase project |
| Who uses it | the whole club | you and Sameh |

The app shows an orange **"STAGING · TEST COPY"** bar at the top on any domain that
isn't `vortexswimmingclub.com`, so the two can never be confused.

---

## One-time setup

### 1. Create the staging branch

```bash
git checkout -b staging
git push -u origin staging
```

Vercel builds it and gives you a URL like `vortex-sc-git-staging-….vercel.app`.

### 2. Give it its own database

**Do not point staging at the live project** — a bad migration there would hit real
swimmers.

1. Supabase → **New project** (free tier), call it `vortex-staging`
2. In the new project's SQL Editor, run **in this order**. The order is not cosmetic —
   see the warning below it.

   **a. The tables**
   - `supabase/all_tables.sql`
   - `supabase/family_accounts_final_fix.sql`
   - `supabase/run_all_pending.sql`
   - `vortex-app/supabase/memberships_and_entries.sql`
   - `vortex-app/supabase/invoices.sql`
   - `vortex-app/supabase/inbody_readings.sql`
   - `vortex-app/supabase/media_private.sql`

   **b. Who counts as staff — BEFORE anything in (c)**
   - `vortex-app/supabase/security_4_roles.sql`
   - `vortex-app/supabase/staff_access_repair.sql`

   **c. The tables that were split out of the shared document, one row each**
   - `vortex-app/supabase/squads.sql`
   - `vortex-app/supabase/video_analyses.sql`
   - `vortex-app/supabase/audit_log.sql`

> ### Why (b) has to come before (c)
>
> Every file in (c) ends with a block that reads: *if `vx_is_staff()` exists, make this
> table writable by staff; otherwise make it writable by anyone signed in, and say so.*
>
> Run them before (b) and they take the second branch. The club then has tables that any
> parent can write to, and a `NOTICE` nobody read scrolled past in the Messages tab. Worse,
> re-running (b) afterwards does **not** go back and tighten them — the policies were
> already created, and they stay as they were made.
>
> This is exactly what happened to the live club: `vx_squads_t` was seeded while its policy
> was still the permissive one, which is why it looked like writes worked and then didn't.
>
> **After running (c), check the Messages tab.** Each file prints one of two notices. You
> want the one ending "writable by staff". If you see "writable by ANY signed-in user",
> run (b) and then that file again.
3. Vercel → Settings → Environment Variables. For each Supabase variable, add a second
   value scoped to **Preview** only, using the staging project's URL and keys:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

Leave the **Production** values pointing at the real project.

> The app also has the live Supabase URL hard-coded as a fallback in
> `public/proto.html` (`SB_URL`). Change that line on the `staging` branch only, so a
> staging build can never write to the real database.

---

## Day-to-day

```bash
git checkout staging
git merge main          # start from what is live
# ...make the change...
git commit -am "try the new thing"
git push
```

Open the staging URL, check it on your phone, then ship it:

```bash
git checkout main
git merge staging
git push
```

---

## What to always test on staging first

- Anything touching **attendance**, **family accounts**, or **login** — every serious
  problem so far has been in one of those three
- Any **SQL migration** — run it on staging first and confirm the app still works
- Anything a **parent** sees

## What is fine to push straight to `main`

- Wording, colours, spacing
- A new report or export
- Anything you can undo in one click

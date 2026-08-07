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
2. In the new project's SQL Editor, run, in order:
   - `supabase/all_tables.sql`
   - `supabase/family_accounts_final_fix.sql`
   - `supabase/run_all_pending.sql`
   - `supabase/security_1_admins.sql`, `security_2_lockdown.sql`
   - `supabase/security_family_read_lockdown.sql`
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

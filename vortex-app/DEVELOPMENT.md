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

## Who can see what (row-level security)

Until Stage 4, every policy read `to authenticated using (true)`. `authenticated` means *any*
signed-in user, and parents sign in through the same Supabase Auth as coaches — so the database
treated a parent and the head coach identically. The screens never offered a parent another
family's messages or the club's billing; but screens are not a security boundary, RLS is.

`supabase/security_4_roles.sql` tells them apart. Undo with `security_4_rollback.sql`.

**Before running it**, open it and put the managers' sign-in emails in the marked block —
Ahmed and Sameh are built into the app rather than the `staff_accounts` table, so they are not
picked up automatically and would lock themselves out. The script refuses to run with an empty
staff list rather than bricking the club.

After Stage 4:

| | staff | a family |
|---|---|---|
| plans, seasons, dryland, lounge, sign-up alerts | everything | nothing |
| messages, documents, wellness, HR, wearables | the club | only their own linked children |
| attendance | mark and read | read their own children only |
| family accounts | the list | their own row |
| staff accounts | change | look up a username to sign in; no changes |
| announcements | write | read |
| club_state | everything | read; may write only `vx_billing`, `vx_sw_meta`, `vx_event_requests`, `vx_notifications` |

### The part that is still open, and why

`club_state` holds the whole club in a handful of JSON rows — roster, fees, memberships,
billing, staff overrides — and the family portal reads it for the roster and results. RLS works
on rows, not on fields inside a JSON document, so it cannot hand a family a partial view of one.
**Reads of `club_state` are therefore still open to any signed-in user.** Writes are pinned to
the four keys the family portal actually uses.

Closing it properly means one of: splitting `club_state` into per-concern tables that can carry
their own policies, or serving the family portal from a Next.js route that holds the service-role
key and returns only that family's slice. The second is smaller and is the recommended next step.

### Testing it

Run it against a **staging Supabase project** and a branch preview first, with the rollback open
in another tab, and check all four in that order:

1. a coach signs in, marks a register, saves a plan;
2. a parent signs in, sees their own child and **not** another family's messages;
3. a parent's "I've paid" still saves;
4. a brand-new parent can register and link a child.

A write the database refuses now shows in the app as *"refused — this account is not allowed to
make that change"* and is **not** retried, so a policy that is too tight shows up as a clear
message rather than a red banner that never clears.

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
| 5 | Meet declarations end-to-end (approve → auto-enter → export CSV) | ✅ shipped |
| 7 | Wellness / hydration daily check-ins | ✅ shipped |
| 8 | Progress analytics — Top Improvers board | ✅ shipped (grows as dated history is entered) |
| 10 | Calendar sync (meets → ICS feed) | ✅ shipped |
| 9 | Arabic / multi-language (RTL) | ✅ family side shipped · staff side still English (see below) |
| 6 | Break the single file into modules | 📋 partial — routes/libs already modular; proto.html is a design-runtime artifact (see below) |

### Beyond the ten

| Item | Status |
|------|--------|
| Fees & invoicing (issue, chase, mark paid, family "I've paid", CSV) | ✅ shipped |
| Live meet day (poolside times → PBs, charts and family app at once) | ✅ shipped |
| Race Strategy (split targets from a goal, vs the race swum) | ✅ shipped |
| Load & Risk (acute:chronic load, wellness, attendance) | ✅ shipped |
| Card payments taken inside the app | ❌ not built — see below |

### Arabic: what is done and what is not

Shipped: a `tx.<key>` dictionary (`_i18n()`), a per-device language choice (`vx_lang`, so a
parent switching to Arabic does not flip the coach's iPad), `dir`/`lang` set on the document so
the browser's own bidi handling flips rows, inputs and scrollers together, and an EN/عربي toggle
on both the family sign-in screen and the portal header. Translated: **family sign-in and
registration, and the whole family portal** — the screens a parent actually opens.

Not translated yet: the **staff side** (squads, plans, attendance, tools, admin). It is a much
larger surface and no parent sees it. To extend, add the key to `_i18n()` and replace the literal
in the markup with `{{ tx.key }}` — the test suite fails on a key that has no Arabic, on an Arabic
string that is just a copy of the English, and on family-portal strings slipping back to
hardcoded English.

### Payments: the deliberate boundary

The app runs the **ledger** — issue, chase, confirm, export — not the card rail. There is no
payment provider integrated and no keys are stored. A club pastes its own payment page (Tap,
MyFatoorah, Stripe) into Settings → Payment link and families get a "Pay now" button that opens
it. Taking card details inside the app would mean a provider account, a server-side secret and
PCI scope, and is a deliberate next decision rather than an oversight.

### Why #6 is a dedicated effort, not a quick win

- **#6 Modularize** — the Next.js side (API routes, `src/lib/*`) is **already modular**. The giant
  file is `public/proto.html`, which is a **Claude Design runtime** artifact: its inline `<script>`
  and `{{ }}` / `sc-for` / `sc-if` markup are read by that runtime as one unit, so it can't be
  safely split without migrating off the design runtime to a normal component framework (React/Vue).
  That migration is worthwhile long-term but is a project in itself — best planned deliberately,
  on a branch, with the app fully re-tested.

## Notes on the two biggest efforts

- **Security lockdown (P0)** and **modularization** are the two changes that most reduce risk.
  Both should be done on a **preview + staging DB** first, with a rollback SQL ready — never
  directly against the live club.
- Modularization can be incremental: start by moving the SQL and route helpers (done), then
  extract the storage shim, then split the giant render object from the class methods.

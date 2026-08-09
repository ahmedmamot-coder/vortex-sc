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

## InBody scans live in the database, one row per scan

**Run `supabase/inbody_readings.sql` in the Supabase SQL editor.** Until it exists, saving a scan
says so plainly and names the file to run.

Scans used to sit inside `vx_sw_meta` — a single JSON document holding every swimmer in the club,
cached in the browser and written back whole. That shape loses data, and did, twice. Saving one
scan meant rewriting the entire club's record, so the newest copy was whichever device last
pushed the whole blob; a phone whose storage was full pushed back a stale copy and **destroyed
scans that were already safely on the server**.

`inbody_readings` is one row per scan, keyed `<swimmerId>::<date>`. Two coaches saving two
swimmers at once touch different rows, a device with no room to cache anything still writes, and
nothing rewrites a record it was not asked to. Weight, PBF and SMM are columns because they are
charted and compared; the rest of the sheet rides along as `vals` jsonb, so a newer InBody model
printing a new field does not need a migration first.

Anything recorded before the table existed is still read from the old blob, copied up once
automatically, and shown only once while both copies exist. Nothing is ever written back to the
blob. `0001_init.sql` declares an older `inbody_scans` table keyed on `swimmers(id)` as a uuid;
the app identifies swimmers by the roster's text ids and never used it — it is left alone.

## Reading an InBody sheet from a photograph

A PDF with a real text layer is read directly, in the browser, with no setup.

A **photograph** — including a scanner app's PDF, which is a photograph in a PDF wrapper — is
sent to `/api/inbody/read`, which reads it with a vision model and returns the values. This
needs one environment variable in Vercel:

| Variable | Where it comes from |
|---|---|
| `ANTHROPIC_API_KEY` | platform.claude.com → API keys. Server-side only; it never reaches a phone. |

The account also needs **credit**. Evaluation access is free but has no balance to spend, and a
key on it is valid, is accepted, and is then refused with *"your credit balance is too low"* —
which looks nothing like a billing problem from the poolside. Plans & Billing → add a card.
Reading a sheet costs a fraction of a fils.

**Paste the key straight from the console into Vercel.** Parking it in a phone's notes app in
between is what broke this the first time: a notes app wraps a hundred-character line, the
wrapping is copied along with it, and the key is stored with spaces in the middle. It looks
perfect in the settings box and fails only when a request header is built from it. Whitespace is
now stripped wherever it lands, and `/api/inbody/read` reports it, but the cleanest paste is the
one that never goes through a phone.

Open `/api/inbody/read` in a browser to see whether a key has reached the running deployment —
it reports the key's length and shape but never the key, and `checkedAt` shows it is answering
now rather than from a cache. In the app, **Check the reader** under the InBody import runs the
same path in stages and names the one that broke.

Without it the route reports `notConfigured` and the app falls back to in-browser OCR, which
works but is slow on a phone — it has to fetch a worker, a WASM core and a large language model
before it can read anything. That fallback has a 45-second deadline; before, it could hang for
ever, and did.

Whatever reads it, a photograph **fills the form in and waits to be checked**. A misread digit
would put a wrong body-fat figure on a child's record looking exactly as authoritative as a
correct one, so a person confirms it before it is saved. A text PDF still saves itself.

**There is nowhere in the app to enter a key, deliberately.** Settings used to offer a box that
kept an Anthropic key on the device; nothing ever read it, no page in this app calls Anthropic,
and none should — a key in a browser can be read off the phone by whoever is holding it, and it
bills the club. The box is gone, any copy an earlier build left behind is deleted on start-up,
and Settings now shows **Check the AI reader**, which asks the server whether a key is set and
reports its length without ever returning it.

## Bands (WHOOP & Fitbit) — switching them on

The integration is complete and real: OAuth consent, token refresh, live calls to WHOOP's
recovery / sleep / cycle endpoints and Fitbit's heart-rate / HRV / sleep endpoints, written to
`wearable_readings` and shown on the swimmer's profile and in the family portal. What it cannot
do is invent credentials — until these are set, "Connect WHOOP" has nothing to connect to, and
the app now says which piece is missing instead of showing an error page.

**In Vercel → Settings → Environment Variables (Production):**

| Variable | Where it comes from |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role`. Server-only; never in the browser. |
| `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET` | developer.whoop.com → your app |
| `WHOOP_REDIRECT_URI` | exactly `https://vortexswimmingclub.com/api/whoop/callback`, and registered on the WHOOP app |
| `FITBIT_CLIENT_ID` / `FITBIT_CLIENT_SECRET` | dev.fitbit.com → Manage Apps |
| `FITBIT_REDIRECT_URI` | exactly `https://vortexswimmingclub.com/api/fitbit/callback`, registered on the Fitbit app |
| `WHOOP_SYNC_SECRET` | optional; if set, `/api/wearable/sync` requires it as `x-sync-secret` |

Run `supabase/wearable_connections.sql` and `supabase/wearable_readings.sql`, then redeploy.
`/api/wearable/status` reports what is still missing, and names no secrets.

**How "live" it is.** Recovery, sleep and strain are produced by the band once a day, in the
morning — there is no second-by-second feed to read. The daily cron in `vercel.json` pulls at
05:00, and **Sync now** on a swimmer's profile pulls that swimmer immediately, which is what to
use poolside. A more frequent cron needs a Vercel plan that allows it; the Hobby plan is one run
a day.

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

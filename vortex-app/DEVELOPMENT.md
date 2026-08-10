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

## Two-step sign-in (MFA) — removed

Built and then removed the same evening, at the club's request. The code is gone: no gate, no
enrolment screen, no admin reset, no `/api/staff/mfa-reset`. Nobody is asked for a code and
nothing consults a factor, so any TOTP factor left on an account in Supabase is simply never
looked at. Remove them from Supabase → Authentication → Users if you want them gone entirely.

**What went wrong was not the cryptography — it was where the enrolment sat.** It happened at the
door, so somebody who got stuck could not get in to fix it, and the escape hatch needed a
service-role key that was never set. The manager locked himself out of his own admin account
inside ten minutes.

If this is ever wanted again, the order that would work: enrol from **inside** the app while
already signed in, set `SUPABASE_SERVICE_ROLE_KEY` so the reset works, prove the reset on two
accounts, and only then make it required — staff first, families much later if at all. Requiring
it of 300 families on day one was the wrong call and it was mine to get right.

## Signing in with Google or Apple

Offered on the family sign-in and registration screens, in English and Arabic. A parent who
already has a Google or Apple account should not have to invent another password for the club —
a password invented for one small app is the one most likely to be reused or written down.

**Enable each provider in Supabase → Authentication → Providers**, and add the site URL to the
redirect allow-list. Until a provider is enabled its button leads to a Supabase error page; the
buttons are shown regardless because hiding them would need a config read from the browser.

| Provider | What it needs |
|---|---|
| Google | A Google Cloud OAuth client (free). Client ID + secret into Supabase. |
| Apple | An **Apple Developer Program membership — about $99/year**, plus a Services ID and a signing key. There is no free path; if that is not worth it, enable Google only and drop the Apple button. |

**It is a different door into the same building, not a side entrance.** The return from Google or
Apple runs the same MFA gate as a password sign-in — if it did not, the strongest-looking button
on the screen would be the weakest way in. The token is stripped out of the address bar before
anything else happens, since a token left in a URL gets bookmarked, screenshotted and pasted into
chats.

**On the staff side** an account is matched by the email an admin already recorded against it. A
Google account nobody has recorded is refused by name rather than let in as a new coach.

Supabase links a social sign-in to an existing account with the same email address, so a parent
who registered with a password and later taps *Continue with Google* keeps the same account and
the same children.

## Children's files: signed links, private bucket

`vx-media` holds birth certificates, passports, medical certificates, photographs and race
videos. A **public** bucket serves all of those through an endpoint that bypasses row-level
security entirely — so locking the `swimmer_docs` table hid the index and did nothing to the
documents. Anyone with a URL could open a child's passport, with no account.

The app now asks Supabase for a **one-hour signed link** each time it shows a file: avatars,
documents, InBody sheets, the video player and the download link all go through `_mediaSrc()`.

**Run `supabase/media_private.sql` LAST**, once every device is on build `2026-08-10a` or later
(Admin → Settings → About this club names the build). Flip the bucket first and every photo,
document, scan and video breaks at once for all 304 swimmers.

Two details make the switch safe to do in one step rather than as a flag day:

- `_mediaSrc()` returns **what it has** and signs in the background — the stored URL while the
  bucket is still public, the signed one the moment it arrives, then a re-render. Nothing is ever
  a blank box waiting on a request.
- `_openUrl()` never awaits. A window opened after an `await` is a blocked pop-up and the
  document simply never appears, so the tab is opened in the same tick as the tap.

Links are re-signed at 80% of their life, so one cannot expire while somebody is looking at it,
and one request is made per file rather than one per render.

A signed link still leaks if it is forwarded. It stops being a *permanent public address* for a
child's passport, which is what it was.

## Activity log — who did what, and when

**It has to be able to say when it is not working.** The first version showed *"Nothing recorded
yet"* for four completely different situations: the panel had not been loaded, it was loading, the
log was genuinely empty, and the database had refused the read. Pressing **Load** and pressing
nothing looked identical, so a log that was never created and a log with nothing in it were the
same screen. `__vxSelect` is the reason — it flattens every failure to `null`, which is right for
a roster that can retry and wrong for anything that has to explain itself, because a missing table
(404) and a table whose policies return nothing (200 with an empty list) come back the same.

`__vxSelectRaw` returns `{status, rows, said}`, and the panel now names the situation: the SQL file
to run when the table is missing, "the database refused the read" on a 401/403, and — when the read
worked and returned nothing — that the entries are being *refused* rather than not happening.

**Check recording** answers the question properly, by recording something: it writes one
`log.check` entry and reads it back. A read alone cannot tell an empty log from a log nothing can
be written to, and those two need opposite actions. Written **and** read back is the only outcome
called working.

The panel also loads itself on the way in — every other Admin panel arrives with its contents, and
this one arrived with a button — and its search box carries `autocomplete="off"` and a real `name`,
because Safari was filling it with the signed-in account's own email address the moment the panel
opened, silently filtering out every entry.


**Run `supabase/audit_log.sql`.** Admin → **Activity log** reads it. Until the table exists the
screen says so by name; the app carries on either way, because recording something must never be
able to stop it happening.

Recorded: sign-in and sign-out (staff and family), a session saved, a register marked, invoices
issued, an invoice marked paid, a membership changed, a document uploaded, an InBody scan saved
or deleted, meet entries changed, a staff password set, a staff account deleted.

Three properties make it a log rather than a list of events:

- **Append-only.** There is an insert policy and a read policy and deliberately *no update or
  delete policy at all* — with RLS on, a command with no policy is refused for everybody. Not
  even a manager can rewrite it from the app. Removing a row needs the SQL editor, which is a
  deliberate act rather than a tap.
- **The server stamps the time.** `at` defaults to `now()` and the app never sends one. Device
  clocks are wrong often enough to matter, and a timeline assembled from twelve phones' opinions
  of the time is not a timeline.
- **It records what changed, not the contents.** "saved a session for Vortex B, 6,700 m" and not
  the plan; "uploaded a medical certificate" and not the certificate. An audit log is read by
  more people than the thing it describes, so copying children's data into it widens the
  exposure rather than narrowing it. The device is stored as a kind — iPhone, iPad, Mac — not the
  full user-agent, which is a fingerprint and answers no question anybody has.

Reading it is staff-only **once `security_4_roles.sql` has been run**. Before that, the script
falls back to any signed-in user and says so in its output.

## A write the database will never accept

`8 changes have not been saved — family_accounts · HTTP 400 · retrying automatically`

Three separate faults met in that one line.

**A 400 was retried forever.** Only `403` was treated as final. But a 400 is the database
rejecting the *shape* of the write — a column that does not exist (42703), a NOT NULL column the
app never sends (23502), a text id against a uuid column (22P02). The same bytes get the same
answer, so it was retried every 45 seconds for as long as the app stayed open, on every device,
behind a banner promising something that could not happen. `_permanent(status)` now decides:
401 is retried (a refresh genuinely fixes it), 408/425/429 and anything 5xx are retried, and every
other 4xx is kept on file and left alone.

**The count was inflated by its own retries.** Each failed retry called back into `_failAdd` and
pushed another entry, so one rejected save could read as *eight changes* — which sounds like eight
lost registrations. Entries are now keyed by operation, table and payload: one write, one entry.

**The banner never said what was wrong.** PostgREST returns the reason in the body, and it was
going to a console nobody has open at the poolside. `said` is now kept and shown, so
*"column family_accounts.pass does not exist"* reaches the person who can act on it, along with
whose problem it is — a permission is the club's to change, a rejected shape is the database's.

`supabase/family_accounts_repair.sql` makes the table accept what the app writes. It is
schema-only **on purpose**: the two earlier repair scripts recreated the wide-open anon policies
as part of their fix, and running one of those today would silently undo the Stage 4 lockdown.

## Signing in must not read a table first

Stage 4 makes `staff_accounts` staff-only. To anyone not yet signed in it therefore reads as
**empty** — and staff sign-in used to look the account up in it to turn a username into an email
address before calling Supabase Auth. On a device that had never been used here, the account list
is the built-in one with no email addresses on it, so that lookup would have turned away every
coach who typed the right password, including whoever had to set the next device up. Applying
Stage 4 without this change locks the club out of its own app.

The family side has worked correctly for months — *"No table read before sign-in"* — and the staff
side now matches it: an email address is used exactly as typed and needs nothing read to resolve
it; the staff row is fetched **after** the token arrives, which on a new device is the first moment
it is readable at all; and an email the app has never seen still gets in, as a coach with no squad,
until the row arrives. A username still works wherever the device already knows the account, which
is the ordinary case, and costs no extra request.

## Who can see what (row-level security)

Until Stage 4, every policy read `to authenticated using (true)`. `authenticated` means *any*
signed-in user, and parents sign in through the same Supabase Auth as coaches — so the database
treated a parent and the head coach identically. The screens never offered a parent another
family's messages or the club's billing; but screens are not a security boundary, RLS is.

`supabase/security_4_roles.sql` tells them apart. Undo with `security_4_rollback.sql`. Both exist
now — this document referred to them for a while before they were written.

**Existing policies are dropped first, and that is the whole point.** Postgres combines
permissive policies with OR, and these tables already carry policies of their own (`open_all`,
`fam_delete`, `attm_lk_delete`, `club_select`). An `open_all ... using (true)` beside a new
staff-only policy means everyone still gets in — the script would report success, every check
would pass, and nothing would be restricted. A security change that quietly does nothing is
worse than none, because from then on everybody believes the club is protected. The script
clears each table it touches and prints the policy names it removed.

**It cannot be verified against this repo.** Most of the schema was created directly in Supabase
and its DDL was never committed, so the script checks every table and every column before it
touches anything, skips what it does not recognise, and **names the skipped tables in the
output**. Anything listed there still has no Stage 4 policy and is still open to any signed-in
user. Read that list — it is the difference between "applied" and "applied to everything".

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

## Memberships and meet entries live in the database, one row each

**Run `supabase/memberships_and_entries.sql`.** Until it exists both keep working exactly as
before, off the old blobs.

`vx_memberships` held every swimmer's package in one JSON document, so changing one rewrote all
304. `vx_meet_entries` held every entry for every meet, so adding one swimmer to one event
rewrote the club's entire declarations. Same shape that lost the InBody scans twice.

What it costs differs and is bad either way. A membership is what a family is charged, so a stale
copy winning does not announce itself — it quietly bills the wrong amount next month. A meet
entry has a **closing date**: one that disappears after the deadline is a child who does not
swim, and nobody finds out until the heat sheets go up.

`setMembership` writes the one swimmer's row, and deletes it when a package is cleared rather
than leaving a stale one behind. Every change to a meet's entries now goes through
`_entriesSave`, which diffs and writes **only the entries that moved** — re-seeding a meet writes
the entries whose heat or lane changed and nothing else, and a scratched entry is deleted.

An entry is identified by meet + swimmer + event, because a swimmer swims an event once at a
meet: re-entering corrects the heat and lane instead of adding a duplicate. `0001_init.sql`
declares a `meet_entries` table keyed on uuids the app never used, so this one is
`meet_declarations` rather than a redefinition of a table already in the schema.

Existing memberships and entries are copied up once, automatically.

## Invoices live in the database, one row each

**Run `supabase/invoices.sql` in the Supabase SQL editor.** Until it exists the app keeps working
exactly as before, off the old blob — but a payment is only as safe as the whole document it sits in.

Invoices lived inside `vx_billing`, one JSON document holding every invoice the club has issued,
cached in the browser and written back whole. Marking one family paid rewrote the entire billing
history. That is the shape that lost the InBody scans twice, and it is worse here: a lost scan is
retyped from a printout, a lost payment is a family told they still owe money they have already
handed over, with no printout to retype it from.

`_billingSave` is the one place every change goes through, so it now diffs against what it had
and writes **only the invoices that actually changed** — marking one paid touches one row, and a
deleted invoice is deleted rather than left to reappear on the next read. Amounts, status and
period are real columns so the database can total and chase them; line items and the payment
record are jsonb, since they vary per invoice and are only ever read back whole.

Invoices raised before the table existed are copied up once, automatically.

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

## The coaching assistants

Workout Review, the swimmer-profile suggestion, Season Architect, Dryland and Nutrition all call
`/api/ai/coach`, which uses the same server-side `ANTHROPIC_API_KEY`. Until today they returned a
hardcoded paragraph after a 1.3-second delay dressed up as thinking — worse than no assistant,
because a coach reads "rest on the 8x100 may be too generous" as a remark about the set they just
wrote.

**No child is identifiable in a request.** The route accepts a fixed list of numbers
(`age`, `attendancePct`, `acuteChronic`, `wellness`, best times as event + seconds …) and a few
short labels, and **drops everything else** — names, dates of birth, swimmer ids, meets, free
text about a person. It is a whitelist, so a later change to the app cannot start leaking names
by accident; a squad label with a sentence smuggled into it is refused too. Tests import the real
filter from the route, not a copy, because what it drops *is* the safeguard.

**The model advises the coach, it does not prescribe to the child.** The system prompt rules out
calorie and weight targets, diet plans, supplements, fasting, anything medical, and heavy lifting
for pre-pubertal swimmers, and tells it to defer to a professional. The reply is re-shaped
server-side into `{title, blocks[]}` — colours are the app's, lengths are capped, and an answer
that arrives malformed becomes an error rather than a half-rendered panel.

The rule-based suggestion on the swimmer profile stays exactly as it was: it works offline, costs
nothing, and is what the screen shows by default. **Ask Claude about this swimmer** sits under it
as a second opinion.

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

### The weight is checked before anything is measured against it

A sheet came back with **8 readings instead of 23**, and the one figure that survived was the
wrong one: 167 kg, on a swimmer 167 cm tall. Height and weight sit next to each other on an
InBody sheet, in centimetres and kilogrammes, and they are the two numbers a reader most easily
swaps.

One wrong field condemned a correct sheet. Every check in `_inbodySanity` is measured against the
weight, so with 167 kg standing in for 55.8 kg the protein, minerals, total body water, fat free
mass and body cell mass were each impossible for a person that size and were thrown out; the
reconciliation then had nothing left to agree with and failed. Fifteen correct readings were
discarded to protect the record from the one number that was actually wrong.

`_weightImplausible(w, h)` now tests the weight first — against the height, and against bounds no
swimmer falls outside — and returns a phrase naming what is wrong with it. When it fails, the
weight is dropped, **nothing is saved**, and the sheet is routed into the form for a person to
correct, with the message saying which number was refused and why. The same check runs in
`addInbody`, for the mix-up typed by hand.

It runs on **all three ways a sheet comes in**. The reconciliation only ever ran on this device's
own OCR, which is the one path the 167 did not take: it came off the server reader, and a text
PDF takes a third path that saves itself with nobody seeing the figure at all. A guard in a place
the bug does not go is not a guard.

Scans already stored are not re-checked — the app cannot know which of the two numbers on an old
record was the mistaken one. Delete the scan with its × and enter it again from the paper.

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

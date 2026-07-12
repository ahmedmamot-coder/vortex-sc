# Vortex Swimming Club

Real production app for the club: staff roles (admin / head coach / coach / fitness
coach), 9 squads, real roster, session plans, attendance, results, and a limited
read-only parent/swimmer family portal.

Built with Next.js (App Router) + Supabase (Postgres, Auth, RLS).

## First-time setup

1. **Create a Supabase project** at supabase.com (free tier is fine).
2. Copy `.env.local.example` to `.env.local` and fill in the three values from
   your project's **Settings → API** page.
3. In the Supabase dashboard, open the **SQL Editor** and run, in order:
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_swimmer_search.sql`
4. In **Authentication → Providers → Email**, turn **off** "Confirm email" so
   family registration signs people in immediately (or leave it on and they'll
   confirm via email first — your choice).
5. Install dependencies and seed the real roster:
   ```bash
   npm install
   npm run seed   # loads all 272 swimmers, 9 squads, 10 meets, PBs & results
   ```
6. **Create your first staff login** (there's no self-registration for staff —
   only parents/swimmers can self-register). In the Supabase dashboard:
   - Authentication → Users → Add user (email + password).
   - Table Editor → `profiles` → insert a row: `id` = that user's UUID,
     `role` = `admin`, `full_name` = your name.
7. `npm run dev` and sign in at `/login`.

## Scripts

- `npm run dev` — local dev server
- `npm run build` / `npm run start` — production build
- `npm run seed` — (re)load the real roster into Supabase (safe to re-run for
  squads/meets; re-running will duplicate swimmers if run twice — see the
  script's comments)

## Structure

- `src/app/(staff)/...` — coach/admin area (squads, roster, plans, attendance,
  results, tools, admin panels)
- `src/app/family/...` — parent/swimmer registration, login and portal
- `src/lib/data/...` — server-side data access functions
- `src/lib/supabase/...` — Supabase client helpers (browser, server, admin)
- `supabase/migrations/` — SQL schema + row-level security policies
- `scripts/seed.ts` — loads the real roster (`scripts/data/roster-export.json`)

## What's built

- **Auth** — staff sign-in; parent/swimmer register → search-and-link → sign in
- **Squads hub, roster** (gender icons), **swimmer profiles** with LCM/SCM
  progression charts
- **Plans** — editable session builder (per-set zone/type/equipment/rest),
  branded A4 print view, and **PDF plan import** (client-side pdf.js parsing)
- **Attendance**, **Results** (by meet)
- **Admin** — swimmers CRUD (incl. PB editor), meets, staff, **academy**
  (trials + fees), **promotion engine** (flag → suggest → approve moves the
  swimmer), **settings** (white-label: club name, 5/6-zone method, currency)
- **Family portal** — read-only Performance / Attendance / Results / Meets
- **Coaching tools** (per squad, under the More tab):
  - **Zone Engine** — 6-zone ruleset + which zones this squad may train
  - **Pace Clock** — live countdown driven by the plan's sets
  - **AI Plan Review** — deterministic rules engine (no API key needed)
  - **T-Pace Tests** — log 400/1000 trials → T-pace/100, retest-due badges
  - **Video Analysis** — YouTube/Vimeo/upload, playback speed (mp4), race-split
    capture (Reaction/15m/Breakout/…/50m per race distance), timestamped notes
  - **InBody & Nutrition** — log scans → BMI, calorie & protein targets, trend
  - **Fitness Plan** — dryland builder (activation/strength/core/mobility)
  - **Meet Management** — status lifecycle, heat/lane entries, printable program

### Notes / future hardening

- **Video uploads** currently use in-browser object URLs so a coach can analyse
  immediately; for durable multi-device storage, wire uploads to Supabase
  Storage (bucket + signed URLs) and store the returned URL instead.
- **InBody import** is manual entry from the PDF/QR sheet. Auto-parsing an
  InBody PDF/QR can be layered on later with the same pdf.js approach used for
  plan import.

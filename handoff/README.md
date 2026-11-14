# Vortex SC — single-file app for the mobile developer

`Vortex-SC-App.html` is the **complete, working Vortex SC app in one file**: every screen
(staff, coaches, families), both languages (English and Arabic), the logo, fonts, images and all
the JavaScript are inside it. Open it in Chrome or Safari by double-clicking. No server,
no install.

It is built from the live app, `vortex-app/public/proto.html`, by
`node handoff/build-single-file.mjs`. **Rebuild it after any change to the app** and do not edit
it by hand.

---

## Important before you open it

- **It is connected to the club's real database** (the production Supabase project). The sign-in
  screens work with real staff and family accounts, and what you see after signing in is real
  swimmers' data. The swimmers are children. Use a test account the club gives you, and do any
  development against the staging project described in `STAGING.md`, not this file.
- Signing in needs internet. The app shell is offline; the data is live.

## What works from the file, and what needs the club's server

| Works straight from the file | Needs the server at vortexswimmingclub.com |
|---|---|
| Every screen, layout, theme, EN/عربي | AI coach, InBody report reading |
| Staff sign-in, family sign-in and registration | Family child-verification, announcements |
| Squads, attendance, results, plans, fees | Push notifications, backups, wearables |
| Printing and CSV/PDF export (in a browser) | Stroke Lab (opens the live page) |
| | The Handbook PDF |

When the file is opened from disk, the server calls (`/api/...`) are sent to
`https://vortexswimmingclub.com`. Browsers may block those from a `file://` page (CORS), so treat
that column as "works in the real app, not necessarily from this file".

---

## Building the store apps

The groundwork is already in this repository; start there rather than from scratch.

| | Where | Read first |
|---|---|---|
| **iOS (App Store)** | `ios/` — Capacitor config, `Info.plist`, native print / files / Face ID plugins, APNs push | `ios/README.md` |
| **Android (Google Play)** | Same Capacitor project (`npx cap add android`), or a Trusted Web Activity of vortexswimmingclub.com | `APP_STORE_AUDIT.md` (`public/.well-known/assetlinks.json` still has `REPLACE_WITH_PACKAGE_NAME`) |
| Store listing, review notes, privacy labels, age rating, screenshots | — | `APP_STORE_SUBMISSION.md` |
| What Apple will check and why each piece exists | — | `APP_STORE_AUDIT.md` |

App id: `com.vortexswimmingclub.app` · App name: `Vortex SC` · Background `#0A0F1A` ·
Brand blue `#067EEA`.

For the native builds, use `vortex-app/public/` + `ios/scripts/sync-web.sh` (which adds
`native-bridge.js` so print, download, share and push work inside the app), **not** this single
file. This file is for seeing and clicking through the whole app; the separate files are
what you ship.

### One thing to check early

Inside the app bundle, the server calls (`fetch('/api/...')`) are relative, so in a Capacitor
build they go to the app's own bundled files instead of vortexswimmingclub.com. They need to point
at `https://vortexswimmingclub.com` (with CORS allowed for the app's origin) for the AI coach,
InBody, push, family verification and the other server features to work in the store apps.
`build-single-file.mjs` shows one way to do it: a small `fetch` wrapper at the top of the page.

---

## The backend, for reference

- **Web app + server:** `vortex-app/` (Next.js, deployed on Vercel). `vortex-app/DEVELOPMENT.md`
  has the architecture.
- **Database and sign-in:** Supabase. Schema and policies in `supabase/` and `vortex-app/supabase/`.
- **Server routes** the app calls: `vortex-app/src/app/api/`.

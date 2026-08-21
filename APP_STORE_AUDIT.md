# Vortex SC — App Store readiness audit

**Audited:** 20 August 2026 · commit `3814b97` · branch `claude/app-store-audit-fijck9`
**Scope:** everything needed to get Vortex SC onto the Apple App Store — the iOS build itself,
App Review guideline compliance, and the privacy/security posture Apple asks you to attest to.

---

## Verdict

**Not submittable today, and the gap is bigger than a submission form.**

Three things are true at once:

1. **There is no iOS app.** The repository contains a Next.js site and a 1.75 MB single-file
   web app (`vortex-app/public/proto.html`) served at the root. There is no Xcode project, no
   Capacitor or Expo config, no `Info.plist`, no `Podfile`. The one native artefact —
   `public/.well-known/assetlinks.json` — is Android (a Trusted Web Activity for Google Play),
   and it still has `REPLACE_WITH_PACKAGE_NAME` in it. **Apple has no TWA equivalent**: you
   cannot point Apple at a URL. A real iOS binary has to exist.

2. **Seven guideline blockers** would get the app rejected even once a binary exists — the two
   most certain being no in-app account deletion (5.1.1(v)) and an unmoderated social feed
   (1.2).

3. **One live privacy problem outranks all of it.** The `vx-media` storage bucket, which holds
   birth certificates, passports and medical certificates for 300+ children, is public by URL
   with no sign-in. The fix is written (`vortex-app/supabase/media_private.sql`) and, per
   `DEVELOPMENT.md`, **not yet run**. Fix that this week whether or not you ever ship to Apple.

Realistic time to a submittable build: **4–6 weeks**, assuming Apple Developer Program
enrolment goes smoothly (it is the long pole and should start today).

---

## A. There is no iOS app yet

### What exists

| | Status |
|---|---|
| Web app (`proto.html`, 1.75 MB, client-side, talks to Supabase directly) | Live |
| PWA manifest + service worker (`manifest.webmanifest`, `sw.js`) | Working, installable |
| Android TWA hooks (`assetlinks.json`) | Placeholder values, not wired |
| iOS project | **Does not exist** |

### Choosing the path

**Recommended: Capacitor wrapper.** It gives you a real `.ipa`, native plugins for the four
things that break in a plain webview (push, share, filesystem, browser), and you keep shipping
the web app the way you do now. Cost: a `ios/` directory in this repo and a Mac (or a cloud Mac)
to build on.

The alternatives — a native SwiftUI rewrite (months, and you would maintain two apps) or not
shipping to Apple at all (keep telling parents to "Add to Home Screen" from Safari, which does
work and costs nothing) — are both defensible. If the App Store listing is mainly about looking
legitimate to parents, the PWA route deserves a serious second look before you spend $99/year
and six weeks.

### Guideline 4.2 (Minimum Functionality) — the risk you must design against

Apple rejects apps that are "a repackaged website." A Capacitor shell pointed at
`vortexswimmingclub.com` with nothing else is exactly the shape reviewers reject.

What answers 4.2, and each of these is also a genuine improvement:

- **Bundle the app shell in the binary** rather than fetching 1.75 MB on every cold start.
- **Native push via APNs** (see B4) — a real iOS capability, not a web one.
- **Native camera / photo picker** for swimmer photos and document upload.
- **Native share sheet and file save** for plans, meet programs and invoice exports.
- **Face ID / passcode lock** on the app — genuinely appropriate for an app holding children's
  medical records, and a visible native feature.
- **Offline access** to today's session plan and the register.

Anything less than about four of these and you are gambling on the reviewer's mood.

---

## B. Hard blockers — these get rejected

### B1. No in-app account deletion — **Guideline 5.1.1(v)**

The only deletion path is `POST /api/family/delete`, which is admin-only by design
(`src/app/api/family/delete/route.ts`: `callerIsAdmin` → `isClubAdmin`). There is no
"delete my account" anywhere in `proto.html`.

Apple's rule is absolute for any app that lets users create an account: deletion must be
initiated **from inside the app**, not by email, not by asking the club. An "email
privacy@..." line in the privacy policy does not satisfy it.

**Fix:** a Settings → Account → Delete account flow for family users that calls a new
self-service endpoint (the existing admin route already handles the hard part — the staff-email
collision — so reuse that logic). Confirm-by-typing, then delete the `family_accounts` row and
the Auth user. Coaching data about the *swimmer* can be retained for club records if the privacy
policy says so, but the *account* must go.

### B2. User-generated content with no moderation — **Guideline 1.2**

The app has a social feed (the Vortex Lounge: posts, image attachments, comments, likes) and a
private family↔coach message thread. Searching `proto.html` for report/block/moderation
functionality returns nothing.

Guideline 1.2 requires **all four**, and reviewers check:

1. A method for filtering objectionable content.
2. A mechanism to **report** offensive content, with a timely response.
3. The ability to **block abusive users**.
4. Published contact information so users can reach you.

Plus an EULA/terms with a zero-tolerance clause for objectionable content, agreed at sign-up.

This is the most common rejection reason for apps like this one, and it is a real requirement
given the audience is children.

**Fix:** report button on every post/comment/message; block-user list; an admin moderation queue
(you already have an audit log to build on); terms acceptance at registration; commit to acting
on reports within 24 hours.

### B3. Children create their own accounts — **Guideline 5.1.4 / 1.3**

The family sign-in offers "I'm a parent" / "I'm a swimmer" (`onFamRoleSwimmer`, `famRole`), so a
12-year-old can self-register. The parental consent page (`public/consent.html`) is good
content, but it is a link next to a sign-up form — not verifiable parental consent, and there is
no age gate.

**Two clean options:**

- **Parents only** (simplest, recommended). Remove the swimmer self-registration path; a parent
  creates the account and can grant a swimmer view. One decision, no Kids Category, no COPPA
  machinery.
- **Keep swimmer logins** and add a real age gate, verifiable parental consent for under-13s, and
  no third-party analytics/ads for those accounts.

Either way, **do not opt into the Kids Category** — it forbids external links and most
third-party SDKs, and this app has both.

### B4. Web Push does not exist inside a wrapper — **functional, Guideline 2.1**

`sw.js` implements Web Push and `proto.html` calls `Notification.requestPermission` and
`pushManager`; `/api/push/send` sends VAPID notifications through `web-push`. **None of this
works in a WKWebView.** iOS Web Push is available only to PWAs installed to the Home Screen from
Safari, never to an embedded webview.

**Fix:** APNs. Apple Push key (.p8) in the developer account, a native registration handshake
storing the APNs token alongside the existing `push_subscriptions` rows, and `/api/push/send`
extended to fan out to both transports (keep Web Push for the Android TWA and desktop).

Ship the app without this and every notification silently stops for iOS users — worse than not
having the app.

### B5. Google sign-in is blocked in embedded webviews — **functional**

`_oauthStart('google')` opens the Supabase authorize URL in the current view. Google refuses
OAuth from embedded webviews and returns `disallowed_useragent` (error 403). Your parents will
see a Google error page.

**Fix:** run the OAuth leg in `ASWebAuthenticationSession` (Capacitor Browser plugin or
`@capacitor-firebase/authentication`), and hand the token back to the web layer via a custom
scheme.

### B6. Sign in with Apple must actually be enabled — **Guideline 5.1.1(iv)**

If the app offers Google sign-in, it **must** offer Sign in with Apple. The button already
exists (`onAppleSignIn`), but `DEVELOPMENT.md` says the provider is not enabled and "until a
provider is enabled its button leads to a Supabase error page."

A dead button is *also* a Guideline 2.1 rejection on its own.

**Fix:** Apple Developer Program membership ($99/yr — needed anyway), a Services ID and a signing
key, both configured in Supabase → Authentication → Providers. Do the same for Google or remove
that button.

### B7. Reviewers need working credentials — **Guideline 2.1**

The whole app is behind a login. App Review will reject "cannot get past the sign-in screen"
within hours.

**Fix:** in App Review notes, supply a **staff** account and a **family** account, both on real
data the reviewer can browse, both left alive for the life of the listing. Include the demo
account in your own smoke test before every submission.

---

## C. What breaks silently inside a WKWebView

These are not guideline questions — they are features that simply stop working the moment the
same HTML runs inside a wrapper instead of Safari. Each is a Guideline 2.1 rejection if a
reviewer taps it.

| Web API | Uses in `proto.html` | What happens in WKWebView |
|---|---|---|
| `window.print()` | 6 | No-op. Session plans, meet programs and invoice printing all die. |
| `a.download` / `createObjectURL` | 3 / 11 | No-op. CSV, PDF and backup exports do nothing at all — no error, no file. |
| `window.open()` | 14 | Returns `null` unless a `WKUIDelegate` is implemented. **This includes `_openUrl()`, which is how children's documents and videos are opened.** |
| `navigator.share` | 2 | Unreliable across iOS versions in a webview; verify or replace with the native share plugin. |
| `localStorage` | 124 | Works, but the system can evict it under storage pressure. With the session and offline queue living here, eviction means a silent logout and possibly lost unsent writes. Move the session to Keychain/Preferences. |

Two more, from the same family:

- **Cold start weight.** `proto.html` is 1.75 MB and is re-fetched (revalidated) on every launch.
  On poolside mobile data an App Store reviewer sees a white screen and files it as a crash.
  Bundle the shell into the binary and let it update in the background.
- **CDN dependencies.** The app pulls from `cdn.jsdelivr.net` and `cdnjs.cloudflare.com`. Offline
  or on a blocked network these fail, and remote script loading invites questions under 2.5.2.
  Vendor them into `/assets` (you already do this for React and Lucide — finish the job).

---

## D. Privacy and data protection

Apple requires accurate Privacy Nutrition Labels and takes children's data seriously. Separately
from Apple, some of the findings below are live risks today.

### D1. CRITICAL — children's documents are publicly addressable

`supabase/storage_bucket.sql` creates `vx-media` with `public = true` and a `select` policy open
to `anon`. That bucket holds, in the words of your own docs, "birth certificates, passports,
medical certificates, photographs and race videos." A public bucket serves files through an
endpoint that **bypasses row-level security entirely** — anyone with a URL opens a child's
passport with no account.

`vortex-app/supabase/media_private.sql` fixes this and the app is already prepared for it
(`_mediaSrc()` requests one-hour signed links). `DEVELOPMENT.md` marks it **pending**, to be run
once all devices are on build `2026-08-10a` or later.

**Verify current state now:**

```sql
select id, public from storage.buckets where id = 'vx-media';   -- must be false
```

If it returns `true`, run `media_private.sql` this week. This outranks everything else in this
document.

### D2. HIGH — `swimmer_docs` is anonymously readable *and deletable*

`supabase/swimmer_docs.sql` lines 26–29 grant `select`, `insert`, `update` **and `delete`** to
`anon`. The anon key is hard-coded in the page source (`SB_ANON` in `proto.html`), so it is
public by definition. Anyone can enumerate the document index for every child — and wipe it.

**Fix:** re-issue those four policies `to authenticated`, and scope reads to staff or the owning
family (`vx_is_staff()` already exists for this).

### D3. HIGH — one parent can read the whole club

Most tables use `for select to authenticated using (true)` — `family_accounts`, `club_state`,
`stage_c_lockdown.sql`'s tables, and others. Since any parent can self-register, "authenticated"
is not a meaningful boundary: a new parent account can read every other parent's name, email,
phone and linked children, plus `club_state`, which `DEVELOPMENT.md` describes as "the whole club
in a handful of JSON rows — roster, fees, memberships, billing, staff overrides."

Your own docs already name the right fix and it is the one I'd take: **serve the family portal
from a Next.js route holding the service-role key that returns only that family's slice.**
Smaller than splitting `club_state`, and it closes the hole properly.

### D4. MEDIUM — three unguarded or under-guarded endpoints

- **`/api/backup/*`** — `guard()` in `src/lib/backupStore.ts` only enforces `BACKUP_SECRET`
  **if that env var is set** (`if (secret) { ... }`). If it is unset in Vercel, full-club export,
  inspect and restore are open to the internet with the service-role key behind them. Make the
  secret mandatory: no secret configured → refuse the request.
- **`/api/push/send`** — checks that the caller is signed in, but not *who*. Any parent can POST
  `{all: true}` and notify the entire club. Gate it on `isClubAdmin` / staff.
- **`/api/ai/coach`** — no authentication at all. Anyone who finds the URL can spend your
  Anthropic credits. (The prompt-level protections for minors in that route are well done and
  worth keeping — this is purely about access.)

### D5. Privacy Nutrition Label — what you must declare

Everything below is **Data Linked to the User**. None of it is used for tracking, so answer "No"
to the tracking question and do **not** include `NSUserTrackingUsageDescription` or the ATT
prompt.

| Category | Collected here |
|---|---|
| Contact Info | Parent name, email, phone |
| Health & Fitness | InBody body composition, wellness check-ins, heart-rate sets, WHOOP/Fitbit readings |
| Sensitive Info | Medical certificates; birth certificates and ID documents |
| User Content | Photos, coaching video, Lounge posts, family↔coach messages |
| Identifiers | User ID, account ID |
| Usage Data | Product interaction (Vercel Speed Insights) |
| Diagnostics | Performance data (Vercel Speed Insights) |

Under-declaring is a rejection *and* a policy violation; over-declaring costs nothing.

### D6. Privacy policy and consent — close, but not finished

`public/privacy.html` and `public/consent.html` are genuinely good — plainly written, honest
about children's data, and already covering consent withdrawal. To be submission-ready:

- Name the **legal entity** and its jurisdiction. Qatar's Law No. 13 of 2016 on Personal Data
  Privacy Protection applies; the policy currently names no law.
- Make `privacy@vortexswimmingclub.com` a monitored mailbox — reviewers do email it.
- Add the in-app deletion route once B1 ships ("you can delete your account in Settings").
- Replace "we are actively strengthening database-level access rules" with a statement of what
  is true on the day you submit. That sentence, read by a regulator after an incident, is an
  admission.
- The self-aware footer ("not legal advice — please have it reviewed") is right: **have a
  Qatari lawyer read both pages** before you put children's medical data behind an App Store
  listing.

---

## E. Payments, health claims, and other guideline exposure

### Payments — you are almost certainly fine (Guideline 3.1.3(e))

The app runs an invoice ledger and a "Pay now" button that opens a club-configured payment page
(Tap, MyFatoorah, Stripe). What is being sold is **swim coaching — a real-world service consumed
outside the app** — which is explicitly exempt from In-App Purchase. No card data is handled and
no provider keys are stored, which is the right boundary.

Two cautions:

- Say this plainly in the App Review notes: *"Fees are for in-person swim training at Hamad
  Aquatic Center. No digital content or app functionality is unlocked by payment."*
- Never let the payment link read as unlocking app features. Keep the wording about pool fees.

### Health data — Guideline 1.4.1 / 5.1.3

The app records body composition and produces calorie and protein targets. For minors this is
sensitive territory, and Apple rejects apps that give medical or dietary direction without
appropriate care. Your AI route already refuses calorie targets, weight targets, supplements and
fasting advice for under-18s — that guardrail is the right instinct and is worth pointing at in
the review notes. Add a visible disclaimer on the InBody and Nutrition screens that the figures
are coaching guidance, not medical advice, and that a qualified professional should be consulted.

### AI disclosure

`AI Plan Review`, the video analysis assistant and `/api/ai/coach` use Claude. App Store Connect
now asks whether the app includes AI chat features; answer honestly, since it affects the age
rating. Keep the "no child is identifiable in the request" property of that route — it is a
strong answer if you are ever asked.

### Guideline 4.3 — one club, or many?

Admin → Settings includes white-label options (club name, currency, zone method). If the plan is
to ship a separate App Store listing per club, Apple rejects near-duplicate apps under 4.3.
**One app with a club selector**, or Apple Business Manager custom apps, are the supported
routes.

---

## F. Store listing checklist

| Item | Status |
|---|---|
| Apple Developer Program enrolment ($99/yr) | **Not started — start today.** Organisation enrolment needs a D-U-N-S number and can take weeks. |
| Bundle ID (e.g. `com.vortexswimmingclub.app`) | Not reserved |
| App Store icon — 1024×1024, **opaque, no alpha, no rounded corners** | Missing. Largest asset is `icon-512.png` at 512×512 with an alpha channel. |
| iPhone screenshots — 6.9" display required | None |
| iPad screenshots | Only if you declare iPad support. **Declare iPhone-only** unless someone tests iPad layouts. |
| Age rating questionnaire | With UGC and messaging, expect **12+ or higher** unless moderation lands (see B2) |
| Privacy policy URL | ✅ `/privacy` — already live and linked from sign-up |
| Support URL | Needed — a page with a real contact route |
| App Review notes: demo accounts + payments explanation + health-guardrail note | Draft below |
| Export compliance | HTTPS only → exempt, but you must answer the question |
| App name / trademark check for "Vortex SC" | Not done |
| `assetlinks.json` still contains `REPLACE_WITH_PACKAGE_NAME` | Broken for Android too — fix while you are here |

### Draft App Review notes

> Vortex SC is the members' app for Vortex Swimming Club, a swim club training at Hamad Aquatic
> Center in Doha, Qatar. It is used by club coaches and by member families; it is not a
> general-audience app.
>
> Demo accounts (both work on real club data):
> · Staff: `<email>` / `<password>`
> · Family: `<email>` / `<password>`
>
> Payments: the app keeps an invoice ledger for in-person swim-training fees and links out to the
> club's own payment page. No digital content or app functionality is unlocked by payment, so
> under 3.1.3(e) these are real-world services consumed outside the app.
>
> Health data: body-composition entries are logged by coaches. The in-app assistant is
> constrained to refuse calorie targets, weight targets, supplements and any medical advice for
> under-18s, and all screens carry a "coaching guidance, not medical advice" disclaimer.
>
> Children's data: accounts are created by parents/guardians, who accept a parental consent
> notice at registration. Account deletion is available in Settings → Account.

---

## G. Recommended sequence

**Phase 0 — this week (do regardless of Apple).**
Run `media_private.sql` after confirming build versions (D1). Close `swimmer_docs` to `anon`
(D2). Make `BACKUP_SECRET` mandatory, gate `/api/push/send` on staff, authenticate
`/api/ai/coach` (D4). **Start Apple Developer Program enrolment in parallel — it is the long
pole.**

**Phase 1 — weeks 1–2, in the web app, where your team already works.**
Self-service account deletion (B1). UGC report/block/moderation plus terms acceptance (B2).
Decide parents-only vs. age gate (B3). Family-portal slice endpoint to close `club_state` (D3).

**Phase 2 — weeks 2–4, the iOS build.**
Capacitor project, shell bundled into the binary, APNs push (B4), native OAuth
(B5) with Sign in with Apple actually enabled (B6), native bridges for print / download / share /
`window.open` (Section C), Info.plist usage strings (`NSCameraUsageDescription`,
`NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`), Face ID lock, offline
plan and register.

**Phase 3 — weeks 4–6.**
1024×1024 icon, screenshots, listing copy, privacy labels, review notes, demo accounts. TestFlight
with the coaches and a handful of parents. Submit.

**Test everything on staging first** — `STAGING.md` already describes the setup, and every item
in Phase 0 and Phase 1 touches attendance, family accounts or login, which is exactly the list
that document tells you never to change on `main` first.

---

## Appendix — what was audited

Repository at commit `3814b97`: `vortex-app/` (Next.js 16 app, 8,844 lines of TS/TSX, 24 API
routes), `vortex-app/public/proto.html` (1.75 MB client app, the production surface), `sw.js`,
`manifest.webmanifest`, `privacy.html`, `consent.html`, 40+ SQL migration and lockdown files
across `supabase/` and `vortex-app/supabase/`, and the project documentation (`README.md`,
`DEVELOPMENT.md`, `SECURITY.md`, `STAGING.md`).

Not verified, because it is runtime state rather than code: the policies actually applied to the
live Supabase project, and which environment variables are set in Vercel. Findings D1, D3 and the
`BACKUP_SECRET` half of D4 depend on that state — each carries the query or check to confirm it.

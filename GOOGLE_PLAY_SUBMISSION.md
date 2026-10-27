# Vortex SC — Google Play submission pack

The Android counterpart to `APP_STORE_SUBMISSION.md`. Everything Play Console asks for, in the
order it asks, written so it can be pasted.

## How the Android app works

Vortex SC on Android is a **Trusted Web Activity (TWA)**: a small Android shell that opens
`https://www.vortexswimmingclub.com` full-screen in Chrome, with no address bar. Nothing in the web
app changes and every Vercel deploy reaches Android users immediately — there is no rebuild
for app changes, only for changes to the shell itself (icon, name, version).

The address bar is hidden only when Android can verify the site and the app belong together.
That is what `vortex-app/public/.well-known/assetlinks.json` is for. **Until it holds the real
fingerprints, the app opens with a browser bar across the top** — still usable, but it looks
like a website, and that is the most common reason a TWA gets a poor review.

| | |
|---|---|
| Package name | `com.vortexswimmingclub.app` (same as the iOS bundle ID — **permanent once uploaded**) |
| App name | `Vortex SC` |
| Start URL | `https://www.vortexswimmingclub.com/` |

> **Always use the `www.` address for Android.** Vercel redirects `vortexswimmingclub.com` to
> `www.vortexswimmingclub.com` (308). PWABuilder does not follow that redirect and reports
> "no manifest", and the Android app's host must be the address that actually serves the page.
| Theme / background colour | `#0A0F1A` |
| Icon | `vortex-app/public/assets/icon-512.png`, maskable `icon-maskable-512.png` |
| Category | Sports |
| Price | Free (cannot be changed to paid later) |

---

## Step 1 — Build the Android package with PWABuilder

1. Open **https://www.pwabuilder.com**, enter `https://www.vortexswimmingclub.com`, press **Start**.
2. Ignore the score; press **Package For Stores** → **Android** → **Generate Package**.
3. Press **All Settings** and set:
   - **Package ID:** `com.vortexswimmingclub.app`
   - **App name:** `Vortex Swimming Club` · **Short name:** `Vortex SC`
   - **Version:** `1.0.0` · **Version code:** `1`
   - **Host:** `www.vortexswimmingclub.com` · **Start URL:** `/`
   - **Theme / background / nav bar colour:** `#0A0F1A`
   - **Display mode:** Standalone · **Orientation:** Portrait
   - **Notification delegation:** On (so club notifications reach the phone)
   - **Signing key:** *Create new*. Fill in your name and the club name; choose a password and
     **write it down**.
4. Press **Download Package**. You get a zip containing:
   - `Vortex SC.aab` — the file you upload to Play
   - `Vortex SC.apk` — for installing on your own phone to test
   - `signing.keystore` and `signing-key-info.txt` — **the upload key**
   - `assetlinks.json` — the upload key's fingerprint

> **Keep `signing.keystore` and `signing-key-info.txt` safe** — in a password manager or a
> private Google Drive folder, never in this repository. Every future update must be signed
> with this key. (If it is ever lost, Play support can reset it because Play App Signing holds
> the real key, but that takes days.)

## Step 2 — Create the app in Play Console

**Play Console → Create app**

| Field | Answer |
|---|---|
| App name | `Vortex SC` |
| Default language | English (United Kingdom) — or English (United States) |
| App or game | App |
| Free or paid | Free |
| Declarations | Tick both (Developer Program Policies, US export laws) |

## Step 3 — Store listing (Grow users → Store presence → Main store listing)

**App name (30)**

```
Vortex SC
```

**Short description (80)**

```
Plans, attendance, results and progress for Vortex Swimming Club, Doha.
```

**Full description (4000)** — the same text as the App Store, with Face ID made generic:

```
Vortex SC is the members' app for Vortex Swimming Club, training at Hamad Aquatic Center in Doha.

It is used by the club's coaches and by the parents and guardians of registered swimmers. It is not a general-audience app — accounts are created by the club and its member families.

FOR PARENTS AND GUARDIANS
· Your child's attendance, race results and personal bests, in one place
· Progression charts across long course and short course
· Upcoming meets, and the entries your child has been given
· Club fees and invoices, and a record of what has been paid
· A private message thread with your child's coach
· Club documents kept securely against your child's record

FOR COACHES
· Build and print a session plan, set by set, with zones, equipment and rest
· Take the register poolside, in seconds
· Squad rosters, swimmer profiles and progression at a glance
· Race analysis with split capture, and technique video with notes
· Test sets and T-pace tracking
· Dryland and fitness planning
· Meet management, heat and lane entries, and a printable programme

BUILT FOR THIS CLUB
· Full Arabic, right to left, throughout
· Works at the poolside, on a phone, on a bad connection
· Notifications for plans, attendance and coach messages

Vortex SC does not sell your data or use it for advertising. Fees shown in the app are for in-person coaching at the pool. You can delete your account at any time in Settings.

Privacy policy: https://vortexswimmingclub.com/privacy
Terms of use: https://vortexswimmingclub.com/terms
Support: https://vortexswimmingclub.com/support
```

**Graphics**

| Asset | Requirement | Source |
|---|---|---|
| App icon | 512×512 PNG, ≤1 MB | `vortex-app/public/assets/icon-512.png` |
| Feature graphic | **1024×500** PNG/JPG, no transparency — **required** | Needs making: logo on `#0A0F1A` |
| Phone screenshots | 2–8, PNG/JPG, 9:16 portrait, at least 1080 px wide recommended | Take on a phone; use the parent portal and a coach screen. **Blur swimmers' faces and names** or use demo data |

**Contact details:** email `privacy@vortexswimmingclub.com` (or the club's general address),
website `https://vortexswimmingclub.com`.

## Step 4 — App content (Policy → App content)

Work down the list; each one turns green when done.

**Privacy policy:** `https://vortexswimmingclub.com/privacy`

**App access:** *All or some functionality is restricted* → add two sets of instructions:

```
Coach / staff account
Username: ⟨email⟩   Password: ⟨password⟩
Sign in on the first screen. Gives the squads, session plans, register and coaching tools.

Parent / family account
Username: ⟨email⟩   Password: ⟨password⟩
Sign in on the first screen. The read-only family portal for one swimmer.
```

Use the same two demo accounts as the App Store review. They must keep working while Google
reviews, and after — Google re-checks apps at random.

**Ads:** No, the app does not contain ads.

**Content rating** (IARC questionnaire):

| Question | Answer |
|---|---|
| Category | **All other app types** |
| Violence, sexuality, language, controlled substances, gambling | No to all |
| Users can interact or exchange content | **Yes** (coach–family messages, club feed) |
| Shares user's location with other users | No |
| Allows purchase of digital goods | No |
| Unrestricted internet access (web browser) | No |

**Target audience and content:**

| Question | Answer |
|---|---|
| Target age groups | **18 and over only** |
| Could the app unintentionally appeal to children? | No |

Why 18+: the people who sign in are coaches and parents; swimmers do not have accounts. Choosing
any age under 13 puts the app under the Families Policy, which this app does not need and would
not pass as built (e.g. it links to external payment pages). The children's data the app *holds*
is declared honestly under Data safety below — that is a separate question from who the app
is *for*.

**News app:** No. **COVID-19 contact tracing:** No. **Government app:** No.
**Financial features:** None of the above. **Health apps:** select **"Fitness / activity
tracking"** only if Play asks; the app is not a medical device.

**Data safety:**

| Question | Answer |
|---|---|
| Does the app collect or share user data? | Yes |
| Is all data encrypted in transit? | Yes (HTTPS only) |
| Can users request deletion? | Yes — in-app (Settings → Your account → Delete my account) |
| Account deletion URL | `https://vortexswimmingclub.com/support` |

Data types — mark each **Collected**, **not Shared** (Supabase and Vercel are service providers,
which Play does not count as sharing), **processed ephemerally: No**:

| Data type | Required or optional | Purposes |
|---|---|---|
| Personal info → Name | Required | App functionality, Account management |
| Personal info → Email address | Required | App functionality, Account management |
| Personal info → Phone number | Optional | App functionality, Account management |
| Personal info → Other info (swimmer date of birth, gender, squad) | Required | App functionality |
| Health and fitness → Health info (medical notes, body composition) | Optional | App functionality |
| Health and fitness → Fitness info (attendance, results, training) | Required | App functionality |
| Messages → Other in-app messages | Optional | App functionality |
| Photos and videos → Photos | Optional | App functionality |
| Photos and videos → Videos (technique video) | Optional | App functionality |
| Files and docs | Optional | App functionality |
| Device or other IDs (push notification token) | Optional | App functionality |
| App info and performance → Diagnostics | Required | Analytics (Vercel Speed Insights) |

## Step 5 — Testing track, then production

**Which applies to you depends on the developer account type:**

- **Personal account created after November 2023:** Google requires a **closed test with at
  least 12 testers who stay opted in for 14 days in a row** before you can apply for
  production. With 300 member families this is easy: pick 15–20 parents and coaches, put their
  Gmail addresses in a Google Group, and add the group as the tester list. Ask them to install
  from the opt-in link and keep it installed for the full 14 days.
- **Organisation account (with a D-U-N-S number):** no tester requirement; you can go to
  production straight after internal testing.

Either way, start with **Test and release → Testing → Internal testing**:

1. **Create new release** → accept **Play App Signing** (the default).
2. Upload `Vortex SC.aab`. Release name `1.0.0 (1)`. Notes: `First release.`
3. **Save → Review release → Start rollout to Internal testing.**
4. Add yourself as a tester, open the opt-in link on your Android phone, install.

## Step 6 — Finish assetlinks.json (removes the browser bar)

After the first upload, Play re-signs the app with its own key, so the site must trust **two**
fingerprints:

1. **Test and release → Setup → App signing** (sometimes *App integrity → App signing*).
   Copy the **SHA-256 certificate fingerprint** under *App signing key certificate*.
2. Copy the fingerprint from the `assetlinks.json` in the PWABuilder zip (the upload key).
3. Put both in `vortex-app/public/.well-known/assetlinks.json`:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.vortexswimmingclub.app",
      "sha256_cert_fingerprints": [
        "⟨App signing key SHA-256 from Play Console⟩",
        "⟨Upload key SHA-256 from the PWABuilder zip⟩"
      ]
    }
  }
]
```

4. Deploy, then check `https://www.vortexswimmingclub.com/.well-known/assetlinks.json` shows the
   file, and run Google's checker:
   `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://www.vortexswimmingclub.com&relation=delegate_permission/common.handle_all_urls`
5. On the phone: uninstall, reinstall from the test link. The browser bar should be gone.
   (Android caches the check — if the bar is still there, clear Chrome's data or wait an hour.)

## Step 7 — Release to production

**Test and release → Production → Create new release** → *Add from library* → pick the same
`1.0.0 (1)` bundle → **Countries/regions:** Qatar at minimum (add others if members travel
or live abroad) → **Send for review**. First reviews usually take 1–7 days.

## Updating later

- **Web app changes:** deploy to Vercel as normal. Nothing to do on Play.
- **Shell changes** (icon, name, colours, new Android target level that Play asks for): rebuild
  in PWABuilder with **"Use mine"** for the signing key (upload `signing.keystore` and its
  passwords), **increase the version code** by 1, upload to a new release.

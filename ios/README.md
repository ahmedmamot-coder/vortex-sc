# Vortex SC — the iOS app

This directory is everything the App Store build needs that a Mac cannot generate for you:
the Capacitor configuration, the `Info.plist` values, the three native plugins that make
printing, saving and document-opening work, and the build script that assembles the web app
into a bundle the binary carries.

**A Mac with Xcode is required from step 3 onwards.** Everything before that runs anywhere.

---

## Why there is a wrapper at all

The club's app is one HTML file served from vortexswimmingclub.com. Apple will not accept a
URL — there is no iOS equivalent of the Android Trusted Web Activity that Google Play took —
so the same web app is bundled inside a real binary.

Two things follow, and both are deliberate:

- **The app shell ships inside the binary**, not fetched on launch. `proto.html` is 1.75 MB.
  Fetching it on every cold start is most of what people call "the sign-in is slow", and to an
  App Store reviewer on a bad connection it is a white screen they will file as a crash.
  `scripts/sync-web.sh` copies the shell in; the data still comes from Supabase, live.

- **Guideline 4.2 is answered with real native capability**, not by arguing about it. Push
  through APNs, the system share sheet, the system printer, Face ID on the app, the native
  photo picker, and the plan and register available offline. A wrapper with none of that is
  the shape reviewers reject.

---

## Build it

### 1. Assemble the web bundle (any machine)

```bash
cd vortex-app
npm install
bash ../ios/scripts/sync-web.sh
```

This writes `ios/App/www/`. It is a copy of `public/`, with `native-bridge.js` loaded ahead of
the app so the print/download/share patches are in place before the first tap.

### 2. Point the app at your Supabase project

Nothing to do if you use the club's own project — the URL and the public anon key are already
in `proto.html`. If you are building against staging, change `SB_URL` there first.

### 3. Create the Xcode project (Mac)

```bash
cd vortex-app
npm install @capacitor/core @capacitor/cli @capacitor/ios \
            @capacitor/push-notifications @capacitor/browser \
            @capacitor/share @capacitor/keyboard @capacitor/splash-screen
cp ../ios/capacitor.config.json ./capacitor.config.json
npx cap add ios
```

That generates `vortex-app/ios/App/App.xcodeproj`. Then copy in the parts Capacitor does not
know about:

```bash
cp ../ios/App/App/Info.plist            ios/App/App/Info.plist
cp ../ios/plugins/*.swift               ios/App/App/
cp ../ios/App/App/AppDelegate+Vortex.swift ios/App/App/
bash ../ios/scripts/sync-web.sh
npx cap sync ios
```

### 4. Signing and capabilities (Xcode)

Open `ios/App/App.xcworkspace`, select the **App** target:

- **Signing & Capabilities** → your team. Bundle identifier `com.vortexswimmingclub.app`.
- **+ Capability → Push Notifications**
- **+ Capability → Background Modes** → tick *Remote notifications*
- **+ Capability → Associated Domains** → `applinks:vortexswimmingclub.com`
  (only needed if you want links to the site to open in the app)
- Deployment target **iOS 15.0**, Devices **iPhone** — see the note on iPad below.

### 5. The APNs key (once)

developer.apple.com → Certificates, Identifiers & Profiles → **Keys** → **+**, tick
*Apple Push Notifications service (APNs)*, download the `.p8`. **You get one download.**

Then in Vercel → Settings → Environment Variables:

| Variable | Value |
|---|---|
| `APNS_KEY_P8` | the whole `.p8` file contents, newlines as `\n` |
| `APNS_KEY_ID` | the 10-character key id from the filename |
| `APNS_TEAM_ID` | your 10-character Team ID |
| `APNS_BUNDLE_ID` | `com.vortexswimmingclub.app` |
| `APNS_ENV` | `production` for TestFlight and the App Store; `sandbox` for a build run from Xcode |

And run `supabase/push_apns.sql` once, which adds the two columns the device token needs.

### 6. Sign in with Apple (required — Guideline 5.1.1(iv))

The app offers Google sign-in, so it must offer Apple's. In the same developer portal:
create a **Services ID**, enable *Sign in with Apple*, add
`https://<project>.supabase.co/auth/v1/callback` as the return URL, and create a **Sign in with
Apple key**. Put the Services ID and key into Supabase → Authentication → Providers → Apple.

Until that is done the Apple button leads to a Supabase error page, and a dead button is its
own rejection. `proto.html` hides both provider buttons unless they are configured.

### 7. Archive and upload

Xcode → **Product → Destination → Any iOS Device**, then **Product → Archive** →
**Distribute App** → **App Store Connect**.

---

## iPad

Declare **iPhone only** unless somebody has actually tested the layouts on an iPad. The app is
built for a phone-width screen; an untested iPad build is a rejection under 2.1 for layout
problems, and iPad screenshots you would then have to produce.

---

## What is in here

| Path | What it is |
|---|---|
| `capacitor.config.json` | app id, name, and the plugin settings |
| `App/App/Info.plist` | permission strings, ATS, orientation, URL schemes |
| `App/App/AppDelegate+Vortex.swift` | APNs registration and the notification handlers |
| `plugins/VxPrintPlugin.swift` | `window.print()` → `UIPrintInteractionController` |
| `plugins/VxFilesPlugin.swift` | `<a download>` → the system share sheet |
| `plugins/VxBiometricPlugin.swift` | Face ID lock over the club's data |
| `scripts/sync-web.sh` | assembles `App/www` from `vortex-app/public` |
| `scripts/make-icons.sh` | the 1024 marketing icon and the app icon set |

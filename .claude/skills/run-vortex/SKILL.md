---
name: run-vortex
description: Launch and drive the Vortex SC app to see a change working — dev server plus headless Chromium, with the login and safety steps that this app specifically needs. Use when asked to run, start, screenshot or click through the app, or to confirm a change works in the real app rather than only in tests.
---

# Running Vortex SC

The app is **not at the repository root**. Everything below runs from `vortex-app/`.

```bash
cd vortex-app
npm run dev            # http://localhost:3000
```

Poll the port rather than sleeping, and free it before relaunching:

```bash
timeout 90 bash -c 'until curl -sf http://localhost:3000 >/dev/null; do sleep 1; done'
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill      # before the next launch
```

`/` serves `public/proto.html` — a single 1.8 MB file that is the whole app. The Next.js routes
under `src/app` are the API and a few legacy pages; the thing a user sees is `proto.html`.

## Never write to the club's live database

`proto.html` has the production Supabase URL and anon key hard-coded, so an app you launch here
talks to the **real club**. Before driving anything, block every write:

```js
await page.route('**/rest/v1/**', r =>
  ['GET','HEAD'].includes(r.request().method())
    ? r.continue()
    : r.fulfill({ status: 403, body: '[]' }));
await page.route('**/auth/v1/signup*', r => r.fulfill({ status: 403, body: '{}' }));
```

In this container Supabase is usually unreachable anyway (the proxy denies it), which is a second
safety net — but do not rely on it.

## Driving it

Playwright is installed; use the **pre-installed** Chromium, never `npx playwright install`:

```js
const app = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
const page = await (await app.newContext({ viewport: { width: 430, height: 1000 } })).newPage();
```

### Getting past the login screen

Staff accounts are bundled in the page, so a staff session needs no network:

```js
await page.evaluate(() => localStorage.setItem('vx_session', JSON.stringify({type:'staff', id:'ahmed'})));
await page.reload();
```

A **family** session cannot be seeded that way — it restores from a `family_accounts` row fetched
after boot. Sign in through the UI with Supabase Auth stubbed:

```js
const S = { access_token:'t', refresh_token:'r', expires_in:3600, token_type:'bearer',
  user:{ id:'00000000-0000-0000-0000-000000000000', email:'driver@example.com',
         user_metadata:{ name:'Test Guardian', role:'parent', swimmer_ids:['preteam::pt1'] } } };
await page.route('**/auth/v1/token*', r => r.fulfill({status:200, contentType:'application/json', body:JSON.stringify(S)}));
await page.route('**/auth/v1/user*',  r => r.fulfill({status:200, contentType:'application/json', body:JSON.stringify(S.user)}));
// then: "Parent or swimmer? Sign in / register" → fill email + password → Sign in
```

Some write paths also need a database session to exist, or they queue instead of sending:

```js
await page.evaluate(() => localStorage.setItem('vx_auth', JSON.stringify({
  token:'test-token', refresh:'test-refresh', exp: Date.now()+3600e3,
  uid:'00000000-0000-0000-0000-000000000000', email:'driver@example.com' })));
```

## Selectors that actually work

- **Lucide icons are replaced by SVGs at runtime**, so `i[data-lucide="settings"]` never matches.
  Use the rendered class: `button:has(svg.lucide-settings)`.
- **Sheets scroll in their own container**, not the window — `fullPage: true` and
  `scrollIntoView()` both miss. Find the element that overflows and set its `scrollTop`:

```js
await page.evaluate(() => {
  const sc = [...document.querySelectorAll('div')]
    .filter(d => d.scrollHeight > d.clientHeight + 40 && /YOUR TEXT/i.test(d.innerText||''))
    .sort((a,b) => (a.scrollHeight-a.clientHeight) - (b.scrollHeight-b.clientHeight))[0];
  if (sc) sc.scrollTop = sc.scrollHeight;
});
```

- **Headings are uppercased by CSS**, so `innerText` gives `REPORTED CONTENT` even though the
  source says `Reported content`. Match case-insensitively.

## Expected noise

Two console errors are normal and not your change breaking: `<polyline>`/`<circle>` complaining
about `{{ … }}` (raw template placeholders before hydration), and `ERR_TUNNEL_CONNECTION_FAILED`
reaching Supabase. Anything else is worth reading.

## After editing proto.html

It is one 18,000-line file with a `{{ }}` template above and the app class below. Check both
halves still parse and that every binding you added has a prop:

```bash
bash .claude/skills/run-vortex/check-proto.sh
```

## The other commands

```bash
npm test          # 1054 assertions, node + tests/alias-loader.mjs
npm run lint
npx tsc --noEmit
npx next build
```

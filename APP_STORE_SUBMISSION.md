# Vortex SC — App Store submission pack

Everything App Store Connect asks for, written out so it can be pasted rather than composed
at 1am. Companion to `APP_STORE_AUDIT.md`, which is why each of these exists.

> **Fill in before you submit:** the two demo accounts in the review notes, and the club's
> legal entity name. Both are marked `⟨…⟩` below.

---

## 1. Before the first build

| | |
|---|---|
| Apple Developer Program | $99/year. Organisation enrolment needs a D-U-N-S number and takes weeks — **this is the long pole, start it first.** |
| Bundle ID | `com.vortexswimmingclub.app` |
| Primary language | English (Arabic is declared as a second localisation) |
| Category | Primary **Sports**, secondary **Education** |
| Price | Free |

## What is already done

Verified against the live project on 21 August 2026, not from memory:

| | |
|---|---|
| `media_private.sql` | **Applied.** `vx-media` is private; 126 files intact, no anon access. The bucket had correct RLS policies all along — a public bucket bypasses RLS entirely, so only the bucket flag mattered |
| `moderation.sql` | **Applied.** `content_reports` and `member_blocks` exist, staff-readable. The report button was live in production hitting tables that did not exist |
| `push_apns.sql` | **Applied.** `platform` and `apns_token` columns added; the table is no longer readable with the public key |
| `security_5_swimmer_docs.sql` §1 | **Applied.** `anon` grants on `swimmer_docs` went 7 → 0 |
| `swimmer_status.sql` | **Applied.** Per-row status table, 234 statuses migrated out of the `club_state` blob, added to the realtime publication |

All seven guideline blockers are closed in code and merged. The 1024×1024 opaque icon, the
`Info.plist`, the three Swift plugins and the build scripts are in `ios/`.

## What still has to be run

```
vortex-app/supabase/club_state_staff_only.sql   ← the last audit finding (D3)
```

**Not run yet, deliberately.** The family portal now reads `/api/family/state` instead of
`club_state`, but a device still on an older build reads `club_state` directly — flipping the
policy before they have updated blanks the portal for those families. Deploy, open a parent
account and confirm Performance, Attendance, Results, Meets, Fees and Documents all fill in,
**then** run it. The check is written into the file.

`security_5_swimmer_docs.sql` §2 is optional and stays commented out on purpose: swimmer
photographs live in `swimmer_docs` as `kind='photo'`, so a staff-only read policy would blank
every swimmer photo and empty the Documents tab for all 304 families. The header explains the
id-shape query to run first.

## Vercel environment variables

```
APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_ENV=production
                       ← without these, iOS notifications silently do nothing
BACKUP_SECRET          ← mandatory now; /api/backup/* returns 503 until it is set
VX_MCP_TOKEN           ← only if you want the Claude connector; see CONNECTOR.md
VX_ADMIN_EMAILS        ← optional; makes the admin list independent of the staff table
```

---

## 2. App Store listing

**Name (30 chars max)**

```
Vortex SC
```

**Subtitle (30 chars max)**

```
Your swimming club, in hand
```

**Promotional text (170 chars, changeable without review)**

```
Session plans, attendance, results and your child's progress — for the coaches and families of Vortex Swimming Club, Doha.
```

**Description**

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
· Face ID lock over swimmers' records
· Notifications for plans, attendance and coach messages

Vortex SC does not sell your data or use it for advertising. Fees shown in the app are for in-person coaching at the pool. You can delete your account at any time in Settings.

Privacy policy: https://vortexswimmingclub.com/privacy
Terms of use: https://vortexswimmingclub.com/terms
Support: https://vortexswimmingclub.com/support
```

**Keywords (100 chars, comma-separated, no spaces)**

```
swimming,swim,club,squad,coach,attendance,training,galas,meets,results,doha,qatar,sports,team
```

**URLs**

| Field | Value |
|---|---|
| Support URL | `https://vortexswimmingclub.com/support` |
| Marketing URL | `https://vortexswimmingclub.com` |
| Privacy Policy URL | `https://vortexswimmingclub.com/privacy` |

**Copyright**

```
2026 ⟨Vortex Swimming Club legal entity name⟩
```

---

## 3. App Review notes — paste this verbatim

```
Vortex SC is the members' app for Vortex Swimming Club, a swim club training at Hamad Aquatic
Center in Doha, Qatar. It is used by club coaches and by member families. It is not a
general-audience app and accounts are not open to the public.

DEMO ACCOUNTS (both work on real club data)
  Coach / staff:   ⟨email⟩ / ⟨password⟩
  Parent / family: ⟨email⟩ / ⟨password⟩
Sign in at the first screen. The parent account is the read-only family portal; the coach
account has the squads, plans, register and coaching tools.

ACCOUNT DELETION (5.1.1(v))
Settings (gear icon, top right) → Your account → Delete my account. Type DELETE to confirm.
The account and the sign-in are both removed. The swimmer's own coaching record is the club's
record and is retained, which is stated on that screen and in section 7 of the privacy policy.

USER-GENERATED CONTENT (1.2)
The club feed and the family–coach messages carry user content. Every post, comment and message
has a Report control, and any member can be blocked from the same sheet. Reports go to a
moderation queue that club managers see in Settings, where content can be removed in one action.
Terms with a zero-tolerance clause are accepted at registration and are published at
https://vortexswimmingclub.com/terms. We review reports within 24 hours, and anything
concerning a child's safety is escalated immediately to the club's safeguarding lead.

CHILDREN (5.1.4)
Accounts are created by a parent or legal guardian, who confirms that they are the guardian and
accepts the parental consent notice at registration. Swimmers do not register themselves. The
app is not submitted to the Kids Category.

PAYMENTS (3.1.3(e))
The app keeps an invoice ledger for club fees and links out to the club's own payment page.
The fees are for in-person swim coaching at the pool — a real-world service consumed outside the
app. No digital content or app functionality is unlocked by any payment, and no card details are
entered in or stored by the app.

HEALTH AND COACHING DATA (1.4.1)
Coaches record body-composition readings and the app derives training guidance from them. The
in-app assistant is constrained by its system prompt to refuse calorie targets, weight targets,
body-fat targets, supplements and any medical advice for under-18s, and no swimmer is
identifiable in any request sent to it — it receives numbers and short enums only, never a name
or a date of birth. Every screen showing these figures carries a "coaching guidance, not medical
advice" disclaimer.

SIGN IN WITH APPLE (5.1.1(iv))
Offered alongside Google, both through the system browser session rather than the webview.

DATA COLLECTION
No tracking, no advertising, no third-party analytics SDKs. The app does not present the App
Tracking Transparency prompt because it does not track.
```

---

## 4. Privacy nutrition labels

Answer **"No"** to "Do you or your third-party partners use data for tracking purposes?"

Everything below is **Data Linked to the User**, used for **App Functionality** (and, for the
last row, **Analytics**). None of it is used for tracking or advertising.

| Category | Type | Purpose |
|---|---|---|
| Contact Info | Name, Email Address, Phone Number | App Functionality |
| Health & Fitness | Fitness | App Functionality |
| Sensitive Info | Sensitive Info (medical certificates, ID documents) | App Functionality |
| User Content | Photos or Videos, Other User Content | App Functionality |
| Identifiers | User ID | App Functionality |
| Usage Data | Product Interaction | Analytics |
| Diagnostics | Performance Data | Analytics |

The last two rows are Vercel Speed Insights. If you remove `@vercel/speed-insights`, remove
those two rows with it.

---

## 5. Age rating

Answer the questionnaire honestly. With an unmoderated-at-post-time feed and messaging, expect
**12+**. The answers that matter:

| Question | Answer | Why |
|---|---|---|
| Unrestricted web access | **No** | External links open in SFSafariViewController, not a browser |
| User-generated content | **Yes** | Feed and messages — with reporting, blocking and moderation |
| Chat / messaging | **Yes** | Family–coach thread |
| AI chatbot | **Yes** | The coaching assistant. Staff-only, and constrained as described above |
| Medical / treatment info | **No** | Coaching guidance, disclaimed on screen; no diagnosis or treatment |
| Contests, gambling, violence, mature themes | **No** | |

---

## 6. Screenshots

Required: **6.9″ iPhone** (1320 × 2868 or 1290 × 2796). Six is the maximum, and the first two
are what people actually see.

Suggested order, all from the coach side except where noted:

1. A squad's session plan, printed view — the thing the app is for
2. The register, mid-session
3. A swimmer profile with the progression chart
4. The family portal (parent account) — performance tab
5. Race analysis with splits
6. Meets and entries

**Do not** declare iPad support unless somebody has tested the layouts on one. The app is laid
out for a phone; `Info.plist` sets portrait-only and the target should be iPhone-only.

Take them on a real device or the iPhone 16 Pro Max simulator. Use the demo family account for
shot 4 so no real parent's name or phone number is in a public screenshot — and check every
other shot for a real swimmer's full name before uploading.

---

## 7. Export compliance

`ITSAppUsesNonExemptEncryption` is already `false` in `Info.plist`, so App Store Connect will
stop asking. The app uses HTTPS and nothing else, which is the exemption that covers.

---

## 8. Before you press Submit

**Database — done, re-confirm rather than re-run:**

- [x] `vx-media` is private — `select id, public from storage.buckets where id='vx-media'` returns **false**
- [x] `moderation.sql`, `push_apns.sql`, `security_5_swimmer_docs.sql` §1 and `swimmer_status.sql` applied
- [ ] `club_state_staff_only.sql` run — **only after** a parent's portal is confirmed working on the deployed build

**Configuration — nobody has done these yet:**

- [ ] `BACKUP_SECRET` set in Vercel, and `/api/backup/list` without it returns 503
- [ ] The five `APNS_*` variables set, or iOS notifications silently do nothing
- [ ] Both demo accounts filled into section 3 and signing in, on the build you are actually submitting
- [ ] The club's legal entity name filled into the copyright line

**Behaviour on a real device, not in Safari:**

- [ ] Delete-account works end to end on a throwaway account
- [ ] A report filed from a family account appears in the manager's queue
- [ ] A status set during a register still holds after marking a swimmer — the thing that broke on 21 Aug
- [ ] A push notification arrives from the TestFlight build
- [ ] Print, CSV export and opening a document all work inside the app
- [ ] Sign in with Apple works — or `VX_OAUTH` is unset so neither provider button is shown

**Listing:**

- [ ] Screenshots taken, and containing no real child's name, photo or parent's contact details
- [ ] `privacy@`, `support@` and `safeguarding@vortexswimmingclub.com` all deliver to somebody
- [ ] `/privacy` and `/terms` read by a Qatari lawyer

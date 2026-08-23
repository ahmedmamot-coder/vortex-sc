# Meet result backups

Plain-file copies of meet results, kept outside the app and outside the
`club_state` sync so that a stale device cannot erase them.

## Test — 22 August 2026 (LCM, Hamad Aquatics Center)

33 swims · 23 personal bests · 10 no-shows · 41 entries.

Recovered on 23 August 2026 after the morning's times were overwritten by a
device pushing an older copy of `vx_roster_edits`. Rebuilt from the printed
results sheet (23/08/2026 11:22) and the meet entries export, then verified
against the database: every "PB −Ns" badge on the sheet reconciles exactly
against the swimmer's stored previous best, and every "First time" matches a
swimmer with no prior time in that event.

- `vortex-test-2026-08-22-results.csv` — one row per swim and per DQ/N-S mark.
- `vortex-test-2026-08-22-results.json` — the same data, restore-ready.

The database also holds a master copy in `vx_backups` under the key
`TEST_MEET_RESULTS_MASTER`; `select vx_restore_test_meet();` re-applies it to
every swimmer's record, finding each swimmer by id wherever they currently sit
on the roster.

## Temporary database guard (23 Aug 2026)

A device was pushing an older copy of `vx_roster_edits` every few minutes,
erasing the meet each time it was restored — three times in one day. Refusing
those writes would only leave that device retrying forever, so instead the
database repairs them:

- `vx_apply_test_meet(doc)` — merges the master copy's swims into a roster
  document, finding each swimmer by id wherever they currently sit and skipping
  any who have left the roster.
- `vx_restore_test_meet()` — applies it to the live row. Returns the swim count.
- `vx_apply_test_entries(doc)` / `vx_apply_test_marks(doc)` — the same for the
  meet's entry list and its DQ/N-S marks, which live in `vx_meet_entries` and
  `vx_meet_marks`. A mark is never put back over a lane that now has a time.
- `vx_guard_test_meet_trg` on `club_state` — before each write, repairs an
  incoming `vx_roster_edits`, `vx_meet_entries` or `vx_meet_marks` document that
  has lost the meet. The write still succeeds, so the device sees no error and
  stops destroying the meet.

It repairs a wipe, not an edit. Each key has a threshold — fewer than 30 swims,
three or more entries missing, fewer than six marks — below which the document is
treated as a stale copy. Deleting one entry or clearing one N/S by hand stays
under the threshold and goes through untouched.

Guarding the swims alone was not enough: the device's next push took the entry
list from 41 to 36 and the marks from 10 to 5 — the whole 50 Free block, which
its copy predated — while the swims held at 33.

Verified by replaying the device's actual stale payload: 1 swim went in,
33 landed.

Two properties this trigger must keep, both learned the hard way on the evening
it was written — it blocked every `vx_roster_edits` save for about an hour:

- **`security definer`.** A trigger runs as the signed-in user, so it needed
  rights on `vx_apply_test_meet` that no coach has. Granting those helpers to
  `authenticated` would let any signed-in user rewrite roster documents, so the
  trigger runs as owner instead. Without this, every write returns
  `permission denied for function vx_apply_test_meet`, which PostgREST reports
  to the app as a flat 403 — indistinguishable from a login problem.
- **It cannot throw.** The repair is wrapped so that any failure inside it lets
  the write through untouched and logs a warning. Protecting one meet is never
  worth refusing a coach's save; the worst this guard may do is nothing.

**This is scaffolding, not a design.** Remove it once race results live in their
own per-row table, as meets, entries, attendance and swimmer status already do:

```sql
drop trigger vx_guard_test_meet_trg on club_state;
drop function vx_guard_test_meet();
```

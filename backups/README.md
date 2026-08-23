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
- `vx_guard_test_meet_trg` on `club_state` — before each write, if an incoming
  `vx_roster_edits` document carries fewer than 30 Test swims, the swims are put
  back into it. The write still succeeds, so the device sees no error and stops
  destroying the meet.

Verified by replaying the device's actual stale payload: 1 swim went in,
33 landed.

**This is scaffolding, not a design.** Remove it once race results live in their
own per-row table, as meets, entries, attendance and swimmer status already do:

```sql
drop trigger vx_guard_test_meet_trg on club_state;
drop function vx_guard_test_meet();
```

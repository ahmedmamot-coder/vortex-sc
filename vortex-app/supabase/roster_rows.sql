-- The roster, one row per change instead of one document for the whole club.
--
-- Every addition, edit and removal the club has made lived in a single row of club_state. The
-- last device to change anything replaced every other device's work, silently — which is how
-- 304 swimmers became 317 overnight, and why a set of squad colours vanished the same evening.
-- Three people edit this app every day; one shared document cannot hold that.
--
-- A row is keyed on squad AND swimmer ('junior::sw_12'), because a move is a removal from one
-- squad and an addition to another, and both halves have to exist at once.
--
--   state 'edit'    — a swimmer from the club's own roster, with the fields that were changed
--   state 'added'   — somebody the club added; the whole record is in patch
--   state 'deleted' — somebody removed from that squad
--
-- Sameh editing a Junior and Mary editing a Senior A now write different rows. Neither can
-- overwrite the other, and neither can revert the club — not "less often", not "with a warning".
--
-- Run this in the Supabase SQL editor. Safe to re-run. The app fills it from what the club
-- already has, once, the first time a manager opens it with the table empty.

create table if not exists vx_roster (
  id          text primary key,        -- "<squadId>::<swimmerId>"
  squad_id    text not null,
  sw_id       text not null,
  state       text not null default 'edit',
  patch       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create index if not exists vx_roster_squad on vx_roster (squad_id);
create index if not exists vx_roster_sw    on vx_roster (sw_id);

alter table vx_roster enable row level security;

drop policy if exists vx_roster_read  on vx_roster;
drop policy if exists vx_roster_write on vx_roster;

do $$
begin
  if exists (select 1 from pg_proc where proname = 'vx_is_staff') then
    -- Families read the roster: their child's squad, squad-mates in a relay, the meet list.
    create policy vx_roster_read  on vx_roster for select to authenticated using (true);
    create policy vx_roster_write on vx_roster for all to authenticated
      using (vx_is_staff()) with check (vx_is_staff());
    raise notice 'vx: roster readable by anyone signed in, writable by staff';
  else
    create policy vx_roster_read  on vx_roster for select to authenticated using (true);
    create policy vx_roster_write on vx_roster for all to authenticated using (true) with check (true);
    raise notice 'vx: roster writable by ANY signed-in user — run security_4_roles.sql to narrow it to staff';
  end if;
end $$;

notify pgrst, 'reload schema';

-- After running it, open the app once as a manager. Then check the club is whole:
--   select state, count(*) from vx_roster group by state;
--   select squad_id, count(*) from vx_roster where state='deleted' group by squad_id;

-- ---------------------------------------------------------------------------------------------
-- 2026-08-23: the two things that made this migration lose data, fixed.
--
-- 1. A swimmer can be BOTH edited and added in the same squad — somebody the club added, whose
--    date of birth was typed in afterwards. One `patch` column cannot hold both halves, so the
--    added record overwrote the typed one and the date vanished. `edit_patch` holds the typed
--    half; `patch` holds the added record. Both come back.
--
--    Against the club's real document this is the difference between a round-trip that matches
--    and one that does not: 534 rows, 2 of them carrying both halves, 236 carrying a date of
--    birth.
--
-- 2. The table used to be filled by whichever device noticed it was empty, from THAT device's
--    copy of the roster — which may be hours old. That is the same fault the migration exists to
--    cure. It is filled from the database's own document instead, below, and the app no longer
--    seeds it at all.

alter table vx_roster add column if not exists edit_patch jsonb   not null default '{}'::jsonb;
alter table vx_roster add column if not exists deleted    boolean not null default false;
alter table vx_roster add column if not exists added      boolean not null default false;

-- Fill the table from club_state.vx_roster_edits. Replaces the table wholesale; safe to re-run.
-- Definition lives in the migration applied to the project; re-run it with:
--
--   select vx_roster_seed_from_document();
--
-- Then check it reproduces the document exactly before trusting it — edits, deleted and added
-- must all compare equal to what club_state still holds. Only then set VX_ROSTER_ROWS = true in
-- proto.html, and re-seed immediately before doing so: rows older than the document would take
-- the club back to whenever they were written.

notify pgrst, 'reload schema';

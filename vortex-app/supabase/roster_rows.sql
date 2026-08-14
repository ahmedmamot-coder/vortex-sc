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

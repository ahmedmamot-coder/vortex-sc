-- Shared key/value state for the prototype (public/proto.html) sync shim.
-- The app mirrors selected localStorage keys (vx_family, vx_plans, vx_meets_cal,
-- vx_swimmer_goals, vx_squad_goals, vx_sw_meta, ...) into this table so every
-- device that opens the app sees and saves the same data.

create table if not exists public.club_state (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.club_state enable row level security;

-- The app talks to Supabase with the public anon key from the browser, so the
-- anon role needs read + write on this shared table. These are intentionally
-- permissive: club_state holds shared club data, not per-user private rows.
drop policy if exists club_state_read  on public.club_state;
drop policy if exists club_state_write on public.club_state;
drop policy if exists club_state_update on public.club_state;

create policy club_state_read
  on public.club_state for select
  to anon, authenticated
  using (true);

create policy club_state_write
  on public.club_state for insert
  to anon, authenticated
  with check (true);

create policy club_state_update
  on public.club_state for update
  to anon, authenticated
  using (true) with check (true);

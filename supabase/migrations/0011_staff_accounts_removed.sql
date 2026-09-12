-- Removing a coach who has left.
--
-- The nine coaches and the two admins are hardcoded in the app, so a removal cannot delete a
-- row that was never inserted. Instead the app writes an override row for that account id with
-- removed = true, and every device drops the coach from the staff list on its next read. Custom
-- (Staff-screen) accounts are still deleted outright; this column only matters for the built-in
-- eleven. Default false so every existing row — and every ordinary edit, which never sends this
-- column — reads as present.

alter table public.staff_accounts
  add column if not exists removed boolean not null default false;

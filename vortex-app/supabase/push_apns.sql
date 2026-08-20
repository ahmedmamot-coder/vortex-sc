-- ============================================================================
--  VORTEX SC — push_subscriptions gains an iPhone, and stops being public.
--
--  WHY (1): Web Push does not exist inside a WKWebView, so the iOS app registers with
--  APNs instead and stores a device token rather than an endpoint + keys. Two columns
--  carry the difference; /api/push/send reads them and fans out to both transports.
--
--  WHY (2): the table was granted to `anon` with `using (true)` on all four commands.
--  The anon key is in the page source, so anyone could read every device token the club
--  holds — and delete them, which would silently switch off notifications for everybody
--  with no trace of who did it.
--
--  Paste into Supabase -> SQL Editor -> Run. Safe to re-run.
-- ============================================================================

alter table public.push_subscriptions add column if not exists platform   text;
alter table public.push_subscriptions add column if not exists apns_token text;

create index if not exists push_subscriptions_platform_idx on public.push_subscriptions (platform);

do $$
declare p text;
begin
  alter table public.push_subscriptions enable row level security;
  revoke all on public.push_subscriptions from anon;
  grant select, insert, update, delete on public.push_subscriptions to authenticated;

  for p in select policyname from pg_policies
           where schemaname='public' and tablename='push_subscriptions' loop
    execute format('drop policy if exists %I on public.push_subscriptions', p);
  end loop;

  -- A device registers itself right after sign-in, so insert and update stay open to any
  -- signed-in user: the row IS the registration. Reading the whole table is a different
  -- thing — it is the club's list of every device — and that is staff work.
  create policy push_insert on public.push_subscriptions
    for insert to authenticated with check (true);
  create policy push_update on public.push_subscriptions
    for update to authenticated using (true) with check (true);

  if to_regproc('public.vx_is_staff') is not null then
    create policy push_read on public.push_subscriptions
      for select to authenticated using (public.vx_is_staff());
    create policy push_delete on public.push_subscriptions
      for delete to authenticated using (public.vx_is_staff());
    raise notice 'push_subscriptions: registrable by any signed-in device, readable by staff';
  else
    create policy push_read on public.push_subscriptions
      for select to authenticated using (false);
    raise notice 'push_subscriptions: reads CLOSED. Run security_4_roles.sql, then run this file again.';
  end if;
end $$;

notify pgrst, 'reload schema';

-- The server prunes dead tokens with the service-role key, which bypasses all of the above —
-- so pruning keeps working whichever branch the notice above reported.

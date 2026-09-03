-- ============================================================================
--  VORTEX SC — a family's race request, written in one go by the database.
--
--  A parent picked 50 Breast for the ASD Dragons Invitational and was told
--  "Sent to the coach ✓". The club's list never changed. Twice.
--
--  The second time is the one that says what is wrong. From that single tap the app makes two
--  writes, milliseconds apart, through the same function:
--
--      vx_notifications   — the coach's inbox line   → landed, 11:26:11
--      vx_event_requests  — the request itself       → never arrived; that row had not been
--                                                      touched since 10:06 that morning
--
--  So it is not the sign-in, not the policy and not the network. It is the mechanism.
--
--  Both keys are whole JSON documents in club_state, and a parent's phone holds only its own
--  family's slice of them. Writing one means: read the club's copy, add your row to it, write the
--  whole thing back. That read is the weak point. When it fails the app is right to send nothing —
--  sending the slice would erase every other family's requests — so the write goes quietly onto a
--  retry queue, the parent is told it was sent, and a refresh hands back the club's copy without
--  it. The request is gone from the phone and was never at the club.
--
--  Read-modify-write from a phone was always going to lose this race. The fix is to stop doing it:
--  one call, and the database appends the row itself, under a lock, in one transaction. There is
--  no copy on the phone to send, so there is nothing to skip, nothing to clobber, and nothing to
--  queue.
--
--  Paste into Supabase -> SQL Editor -> Run. Safe to re-run. Nothing is deleted.
-- ============================================================================


-- ---------------------------------------------------------------------------------------------
--  Appending one row to a club_state list, atomically.
--
--  SELECT ... FOR UPDATE takes the row lock, so two parents tapping Request in the same second
--  queue behind each other instead of overwriting one another. Capped at 600 the way the app caps
--  them, because these are whole documents and an uncapped one eventually becomes too big to save.
-- ---------------------------------------------------------------------------------------------

create or replace function public.vx_state_prepend(p_key text, p_rows jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cur jsonb;
begin
  insert into public.club_state(key, value) values (p_key, '[]'::jsonb)
    on conflict (key) do nothing;

  select coalesce(value, '[]'::jsonb) into v_cur
    from public.club_state where key = p_key for update;

  if jsonb_typeof(v_cur) <> 'array' then v_cur := '[]'::jsonb; end if;

  update public.club_state
     set value = (select jsonb_agg(x) from (
                    select x from jsonb_array_elements(p_rows || v_cur) x limit 600) t),
         updated_at = now()
   where key = p_key;
end $$;

revoke all on function public.vx_state_prepend(text, jsonb) from public, anon, authenticated;


-- ---------------------------------------------------------------------------------------------
--  The request itself.
--
--  A parent may ask only for their own child — vx_is_my_swimmer, which family_swimmer_docs.sql
--  repaired so that it compares 'adva::r17' and 'r17' as the same child. Staff may call it too,
--  which is how the app records a race a coach enters on a family's behalf.
--
--  What the caller supplies is the child, the meet and the races. The swimmer's name is clamped
--  and nothing else is free text, so this cannot be used to write an arbitrary line into the
--  club's inbox.
--
--  Returns the rows it actually added, so the phone can show them without a round trip — and an
--  empty list when every race asked for was already on it, which is not an error.
-- ---------------------------------------------------------------------------------------------

create or replace function public.vx_request_events(
  p_sw_id text, p_sw_name text, p_meet text, p_events text[]
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cur    jsonb;
  v_added  jsonb := '[]'::jsonb;
  v_ev     text;
  v_name   text;
  v_now    timestamptz := now();
  v_ms     bigint;
  v_bare   text := public.vx_bare_id(p_sw_id);
begin
  if not (public.vx_is_my_swimmer(p_sw_id) or public.vx_is_staff()) then
    raise exception 'vx: that swimmer is not on this account' using errcode = '42501';
  end if;
  if coalesce(btrim(p_meet), '') = '' or p_events is null then
    return jsonb_build_object('added', v_added);
  end if;

  v_name := left(coalesce(nullif(btrim(p_sw_name), ''), 'Swimmer'), 60);
  v_ms   := (extract(epoch from v_now) * 1000)::bigint;

  select coalesce(value, '[]'::jsonb) into v_cur
    from public.club_state where key = 'vx_event_requests';
  if v_cur is null or jsonb_typeof(v_cur) <> 'array' then v_cur := '[]'::jsonb; end if;

  foreach v_ev in array p_events loop
    v_ev := left(btrim(coalesce(v_ev, '')), 40);
    continue when v_ev = '';
    -- Never a second row for a race this child already has at this meet, whatever its status.
    -- The chips hide those already; this is the rule rather than the appearance of it.
    continue when exists (
      select 1 from jsonb_array_elements(v_cur) r
       where public.vx_bare_id(r->>'swId') = v_bare
         and r->>'meetName' = p_meet
         and r->>'event' = v_ev);
    continue when exists (
      select 1 from jsonb_array_elements(v_added) r where r->>'event' = v_ev);

    v_added := v_added || jsonb_build_array(jsonb_build_object(
      'id',          'req_' || replace(gen_random_uuid()::text, '-', ''),
      'swId',        v_bare,
      'swName',      v_name,
      'meetName',    p_meet,
      'event',       v_ev,
      'status',      'pending',
      'requestedAt', to_char(v_now, 'YYYY-MM-DD'),
      'ts',          v_ms));
  end loop;

  if jsonb_array_length(v_added) = 0 then
    return jsonb_build_object('added', v_added, 'already', true);
  end if;

  perform public.vx_state_prepend('vx_event_requests', v_added);

  -- The coach's inbox line, in the same transaction as the request. These two went separately
  -- before, which is how the club ended up holding the notification for a request it did not have.
  perform public.vx_state_prepend('vx_notifications', jsonb_build_array(jsonb_build_object(
    'id',       'notif_' || replace(gen_random_uuid()::text, '-', ''),
    'audience', 'coach',
    'icon',     'inbox',
    'title',    'New event request',
    'body',     v_name || ' asked for '
                || (select string_agg(r->>'event', ', ' order by r->>'event')
                      from jsonb_array_elements(v_added) r)
                || ' at ' || p_meet || '.',
    'at',       to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'read',     false)));

  return jsonb_build_object('added', v_added);
end $$;

revoke all on function public.vx_request_events(text, text, text, text[]) from public, anon;
grant execute on function public.vx_request_events(text, text, text, text[]) to authenticated;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------------------------
--  CHECK IT
--
--  Studio runs as the service role, which passes every policy — so vx_is_my_swimmer is true for
--  nobody there and the call will refuse. That refusal is itself the check that the guard works:
--
--    select public.vx_request_events('r17', 'Tamara', 'ASD Dragons Invitational', array['50 Free']);
--    -- expected: ERROR  vx: that swimmer is not on this account
--
--  The honest test is the app: sign in as that family, pick a race, tap Request, then
--
--    select jsonb_array_length(value) from public.club_state where key='vx_event_requests';
--
--  should go up by one immediately — no refresh, no waiting for a retry.
--
--  To undo:
--    drop function if exists public.vx_request_events(text, text, text, text[]);
--    drop function if exists public.vx_state_prepend(text, jsonb);
-- ---------------------------------------------------------------------------------------------

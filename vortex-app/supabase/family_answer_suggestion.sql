-- ============================================================================
--  VORTEX SC — a family answering a race the coach put forward.
--
--  The other half of family_event_requests.sql, and the last path still doing the thing that
--  lost a request twice.
--
--  A coach suggests a race; the row sits in club_state.vx_event_requests as 'suggested'; the
--  family taps "Yes, enter them" or "No thanks". Until now that answer was written the old way:
--  read the club's whole list, change the one row, send it all back. A parent's phone holds only
--  its own family's slice of that list, so when the read fails the app is right to send nothing —
--  and the answer goes quietly onto a retry queue while the card says it was recorded.
--
--  Nothing is lost that way, only delayed, which is why it was left until last. But it is the same
--  mechanism that made a request vanish, on the same key, and "only delayed" is not a promise
--  worth keeping when the fix is a dozen lines.
--
--  So the database changes the row itself: one call, under the same lock, with the coach's
--  notification in the same transaction.
--
--  Requires family_event_requests.sql (for vx_state_prepend) and family_swimmer_docs.sql (for
--  the vx_is_my_swimmer repair).
--
--  Paste into Supabase -> SQL Editor -> Run. Safe to re-run. Nothing is deleted.
-- ============================================================================

create or replace function public.vx_answer_suggestion(p_id text, p_yes boolean)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cur    jsonb;
  v_row    jsonb;
  v_status text;
  v_now    timestamptz := now();
begin
  if coalesce(btrim(p_id), '') = '' then
    raise exception 'vx: no request was named' using errcode = '22023';
  end if;

  -- The same row lock the request takes, so an answer and a new request cannot overwrite
  -- one another.
  select coalesce(value, '[]'::jsonb) into v_cur
    from public.club_state where key = 'vx_event_requests' for update;
  if v_cur is null or jsonb_typeof(v_cur) <> 'array' then
    raise exception 'vx: the club has no requests to answer' using errcode = 'P0002';
  end if;

  select e into v_row from jsonb_array_elements(v_cur) e where e->>'id' = p_id limit 1;
  if v_row is null then
    raise exception 'vx: that race is no longer on the club''s list' using errcode = 'P0002';
  end if;

  -- A parent may answer only for their own child. Staff may too, which is how a coach records
  -- an answer a family gave them in person.
  if not (public.vx_is_my_swimmer(v_row->>'swId') or public.vx_is_staff()) then
    raise exception 'vx: that swimmer is not on this account' using errcode = '42501';
  end if;

  -- Only a race the club actually put forward, and only once. A second tap on a stale screen,
  -- or an attempt to answer a request the family raised themselves, changes nothing and is not
  -- an error — the caller is told it was already settled.
  if (v_row->>'status') is distinct from 'suggested' then
    return jsonb_build_object('row', v_row, 'already', true);
  end if;

  v_status := case when p_yes then 'approved' else 'declined' end;

  update public.club_state
     set value = (select jsonb_agg(
                    case when e->>'id' = p_id
                         then e || jsonb_build_object(
                                'status',     v_status,
                                'answeredAt', (extract(epoch from v_now) * 1000)::bigint)
                         else e end)
                    from jsonb_array_elements(v_cur) e),
         updated_at = v_now
   where key = 'vx_event_requests';

  -- The club hears about it in the same transaction, so there can never be an answer the coach
  -- was not told about, or a notification for an answer that did not land.
  perform public.vx_state_prepend('vx_notifications', jsonb_build_array(jsonb_build_object(
    'id',       'notif_' || replace(gen_random_uuid()::text, '-', ''),
    'audience', 'coach',
    'icon',     case when p_yes then 'check-circle-2' else 'x-circle' end,
    'title',    case when p_yes then 'Suggested race accepted' else 'Suggested race turned down' end,
    'body',     coalesce(nullif(btrim(v_row->>'swName'), ''), 'A swimmer') || ' — '
                || coalesce(nullif(btrim(v_row->>'event'), ''), 'a race') || ' at '
                || coalesce(nullif(btrim(v_row->>'meetName'), ''), 'a meet') || '.',
    'at',       to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'read',     false)));

  return jsonb_build_object('row', v_row || jsonb_build_object('status', v_status));
end $$;

revoke all on function public.vx_answer_suggestion(text, boolean) from public, anon;
grant execute on function public.vx_answer_suggestion(text, boolean) to authenticated;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------------------------
--  CHECK IT
--
--  Studio runs as the service role, which passes every policy, so vx_is_my_swimmer is true for
--  nobody there. The honest test is the app: a coach suggests a race, the family taps
--  "Yes, enter them", and
--
--    select e->>'event', e->>'status'
--      from public.club_state, lateral jsonb_array_elements(value) e
--     where key = 'vx_event_requests' and e->>'status' <> 'pending';
--
--  shows it as approved immediately — no refresh, no waiting for a retry. The entry itself is
--  still made by the next staff device to open the app (_reqEnterApproved), because
--  vx_meet_entries is not a key a parent may write.
--
--  To undo:
--    drop function if exists public.vx_answer_suggestion(text, boolean);
-- ---------------------------------------------------------------------------------------------

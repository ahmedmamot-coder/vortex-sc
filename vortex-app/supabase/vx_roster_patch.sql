-- Saving a swimmer sends the fields that changed, not the whole record.
--
-- A roster row's `patch` is every field the club has changed on that swimmer: name, date of
-- birth, nationality, results, PBs. The app wrote it whole, from whatever copy the phone was
-- holding. So a phone left open since before a meet was imported, used to fix one child's
-- nationality, sent that child's old results list with it and the meet was gone from their
-- profile — Ali Dardir and Abdelrahman Metwally lost their Dragons swims exactly that way.
--
-- This merges instead. Each entry names the fields to set and the fields to remove; everything
-- else on the row is left as the database has it, in one statement, so two devices changing two
-- different fields of one swimmer both land. `deleted` / `added` are only changed when sent
-- (null = leave as is). The rows as they now stand are returned, so the device learns what the
-- others did.
--
-- Security invoker: it runs as the signed-in user, under vx_roster's own row-level security
-- (signed-in staff only), exactly as a direct write to the table would.
--
-- Safe to run more than once. Until it has been run, the app falls back to its old whole-row write.

create or replace function public.vx_roster_patch(p_rows jsonb)
returns setof public.vx_roster
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  r   jsonb;
  s   jsonb;
  u   text[];
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'vx_roster_patch expects an array of rows';
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if coalesce(r->>'id','') = '' or coalesce(r->>'squad_id','') = '' or coalesce(r->>'sw_id','') = '' then
      raise exception 'vx_roster_patch: every row needs id, squad_id and sw_id';
    end if;
    s := case when jsonb_typeof(r->'set') = 'object' then r->'set' else '{}'::jsonb end;
    u := case when jsonb_typeof(r->'unset') = 'array'
              then array(select jsonb_array_elements_text(r->'unset')) else '{}'::text[] end;
    return query
      insert into public.vx_roster as t (id, squad_id, sw_id, patch, deleted, added, updated_at)
      values (r->>'id', r->>'squad_id', r->>'sw_id', s - u,
              coalesce((r->>'deleted')::boolean, false), coalesce((r->>'added')::boolean, false), now())
      on conflict (id) do update
        set patch      = (t.patch || s) - u,
            deleted    = coalesce((r->>'deleted')::boolean, t.deleted),
            added      = coalesce((r->>'added')::boolean, t.added),
            updated_at = now()
      returning t.*;
  end loop;
end;
$$;

revoke all on function public.vx_roster_patch(jsonb) from public;
revoke all on function public.vx_roster_patch(jsonb) from anon;
grant execute on function public.vx_roster_patch(jsonb) to authenticated;

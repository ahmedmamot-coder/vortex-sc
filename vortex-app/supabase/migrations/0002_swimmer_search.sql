-- Lets any authenticated user (including a brand-new family account with no
-- links yet) search the roster by name to link their child/self, without
-- opening the full `swimmers` table to them via RLS.
-- Pinned, like the RLS helpers above. This one is granted to `authenticated`, so every parent in
-- the club can call it, and it resolves `swimmers` and `squads` unqualified while running as the
-- owner. Whichever tables those names land on is decided by the caller's search_path unless it is
-- fixed here.
create or replace function search_swimmers(q text)
returns table (id uuid, full_name text, squad_name text, age int, gender text)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.first_name || ' ' || s.last_name as full_name, sq.name as squad_name, s.age, s.gender
  from swimmers s
  join squads sq on sq.id = s.squad_id
  where auth.role() = 'authenticated'
    and (s.first_name || ' ' || s.last_name) ilike '%' || q || '%'
  order by s.first_name
  limit 20;
$$;

grant execute on function search_swimmers(text) to authenticated;

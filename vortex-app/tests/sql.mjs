// Running the SQL, instead of reading it and hoping.
//
//   npm run sql
//
// A query was sent to the club that failed the moment it was pasted in — and because the SQL
// editor runs a script as one transaction, the repair sharing that file was rolled back with it.
// Nothing was fixed and it looked like it had been. The fault was mine and it was findable in
// four seconds by anything that had actually executed it.
//
// So this boots a throwaway Postgres, builds the shapes that break these queries, and runs every
// catalogue-only file in supabase/ against it. It touches no Supabase project and needs no
// network. If Postgres is not installed it says so and passes — better a skipped check than a
// suite nobody can run.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPA = join(HERE, "..", "supabase");
const BIN = ["/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin", "/usr/local/bin", "/usr/bin"]
  .find((d) => existsSync(join(d, "initdb")));
if (!BIN) {
  console.log("\n  skipped — no Postgres on this machine, so the SQL could not be run\n");
  process.exit(0);
}
const DATA = "/tmp/vx-sqltest", PORT = "5433", SOCK = "/tmp";
const psql = (args, input) =>
  spawnSync(join(BIN, "psql"), ["-h", SOCK, "-p", PORT, "-U", "postgres", "-v", "ON_ERROR_STOP=1", ...args],
            { input, encoding: "utf8" });

// initdb refuses to run as root, and this container is root. `su postgres` needs the data
// directory to be somewhere that user can actually reach, which rules out a nested scratch path.
const asPg = (cmd) => spawnSync("su", ["postgres", "-s", "/bin/bash", "-c", cmd], { encoding: "utf8" });
try { rmSync(DATA, { recursive: true, force: true }); } catch {}
mkdirSync(DATA, { recursive: true });
try { execFileSync("chown", ["postgres:postgres", DATA]); execFileSync("chmod", ["700", DATA]); } catch {}
const init = asPg(`${join(BIN, "initdb")} -D ${DATA} -U postgres --auth=trust`);
if (init.status !== 0) {
  console.log("\n  skipped — could not start a local Postgres\n");
  process.exit(0);
}
asPg(`${join(BIN, "pg_ctl")} -D ${DATA} -o '-k ${SOCK} -p ${PORT} -c listen_addresses=' -l /tmp/vx-sqltest.log start`);
for (let i = 0; i < 40; i++) {
  if (psql(["-tAc", "select 1"]).status === 0) break;
  spawnSync("sleep", ["0.25"]);
}

let failed = 0;
const check = (name, fn) => {
  try { const note = fn(); console.log("  ok   " + name + (note ? "  — " + note : "")); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + String(e.message).trim().split("\n").slice(0, 4).join("\n       ")); }
};

// The shapes that matter. A primary key referenced by several foreign keys is what made
// pg_constraint.conindid return more than one row — conindid is set on every foreign key that
// REFERENCES an index, not only on the constraint that owns it.
const FIXTURE = `
create table squads (id text primary key, name text);
create table swimmers (id text primary key, squad_id text references squads(id));
create table attendance_marks (id text primary key, squad_id text references squads(id),
                               sw_id text references swimmers(id), day date, status text);
create table swimmer_docs (id text primary key, swimmer_id text references swimmers(id), kind text);
create index am_sw_idx  on attendance_marks (sw_id);
create index am_sw_idx2 on attendance_marks (sw_id);
create index sd_sw_idx  on swimmer_docs (swimmer_id);
create index sd_sw_idx2 on swimmer_docs (swimmer_id);
create table profiles (id text primary key, email text unique);
create table family_links (email text references profiles(email), swimmer_id text);
create function is_staff() returns boolean language sql stable security definer as $$ select true $$;
create function search_swimmers(q text) returns setof text language sql stable security definer as $$ select name from squads $$;
create function already_pinned() returns boolean language sql stable security definer
  set search_path = public, pg_temp as $$ select true $$;
create function not_definer() returns boolean language sql stable as $$ select true $$;
`;
const built = psql(["-q"], FIXTURE);
if (built.status !== 0) { console.log("could not build the fixture:\n" + built.stderr); process.exit(1); }

console.log("");

// Every file here reads the catalogue and can run against any database, which is the whole point
// of them — they are what says what the club's database actually IS.
for (const f of ["advisor_fixes.sql", "duplicate_indexes.sql", "preflight_audit.sql"]) {
  check(f + " runs without erroring", () => {
    const r = psql(["-f", join(SUPA, f)]);
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
    return null;
  });
}

// Not merely "does not error" — the answers have to be right.
check("advisor_fixes pins the unpinned and leaves the rest alone", () => {
  const r = psql(["-tAc",
    `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig,'{}'::text[])) c where c like 'search\\_path=%')`]);
  if (r.stdout.trim() !== "") throw new Error("still mutable: " + r.stdout.trim().replace(/\n/g, ", "));
  const nd = psql(["-tAc", `select coalesce(array_to_string(proconfig,','),'none') from pg_proc where proname='not_definer'`]);
  if (nd.stdout.trim() !== "none") throw new Error("it touched a function that is not security definer");
  return "and it did not touch not_definer()";
});

check("duplicate_indexes finds both duplicates and names the right one to drop", () => {
  const r = psql(["-tAc", readFileSync(join(SUPA, "duplicate_indexes.sql"), "utf8")
    .replace(/^\s*--[^\n]*$/gm, "").trim().replace(/;\s*$/, "")]);
  if (r.status !== 0) throw new Error(r.stderr);
  const out = r.stdout;
  for (const t of ["attendance_marks", "swimmer_docs"])
    if (!out.includes(t)) throw new Error("did not find the duplicate on " + t);
  // The spare, never the one carrying a constraint.
  if (!/drop index concurrently public\.am_sw_idx2;/.test(out)) throw new Error("named the wrong index to drop");
  if (/drop index concurrently public\.(attendance_marks_pkey|profiles_email_key)/.test(out))
    throw new Error("offered to drop an index that backs a constraint");
  return "2 duplicates, no constraint-backed index offered";
});

// The one that actually bit: the old scalar-subquery form must still fail here, or this fixture
// is not reproducing the thing it exists to reproduce and the test above proves nothing.
check("the fixture really does reproduce the bug that was shipped", () => {
  const r = psql(["-tAc",
    `select (select c.conname from pg_constraint c where c.conindid = i.indexrelid)
       from pg_index i join pg_class ci on ci.oid=i.indexrelid
       join pg_namespace n on n.oid=ci.relnamespace where n.nspname='public'`]);
  if (r.status === 0) throw new Error("the old form no longer fails, so this fixture proves nothing");
  if (!/more than one row/.test(r.stderr)) throw new Error("failed for some other reason: " + r.stderr);
  return "old form still errors, as it did for the club";
});

asPg(`${join(BIN, "pg_ctl")} -D ${DATA} stop`);
try { rmSync(DATA, { recursive: true, force: true }); } catch {}
console.log("\n  " + (4 + 2 - failed) + " passed, " + failed + " failed\n");
process.exit(failed ? 1 : 0);

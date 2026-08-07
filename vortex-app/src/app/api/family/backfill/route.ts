// Rebuild the family_accounts table from Supabase Auth.
//
// Everyone who registered exists as a Supabase Auth user, and what they entered at sign-up
// (name, phone, role, chosen children) was stored on that user. If their family_accounts row
// was refused at the time, this recreates it, so the admin gets everybody back.
//
// GET  /api/family/backfill        -> full diagnostic report, writes nothing
// POST /api/family/backfill        -> actually creates the missing rows
// POST /api/family/backfill?all=1  -> also include @vortexswimmingclub.com addresses
//
// Env: SUPABASE_SERVICE_ROLE_KEY (must be the service_role key, NOT the anon key).

import { SB_URL, SB_SERVICE, haveService } from "@/lib/wearable";

type AuthUser = {
  id: string;
  email?: string;
  created_at?: string;
  user_metadata?: { name?: string; phone?: string; role?: string; swimmer_ids?: string[] };
};

// Describe the configured key WITHOUT revealing it, so a misconfiguration can be
// identified precisely instead of guessed at.
export function probeKey() {
  const k = SB_SERVICE || "";
  const trimmed = k.trim();
  const parts = trimmed.split(".");
  let role: string | null = null, ref: string | null = null, jwt = false;
  if (parts.length === 3) {
    try {
      const p = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
      role = p.role || null; ref = p.ref || null; jwt = true;
    } catch { /* not a readable JWT */ }
  }
  const kind = !trimmed ? "EMPTY — the variable is not set in this deployment"
    : trimmed.startsWith("sb_secret_") ? "new-format secret key (sb_secret_…)"
    : trimmed.startsWith("sb_publishable_") ? "PUBLISHABLE key — this is the public one, it will never work"
    : jwt && role === "service_role" ? "legacy service_role JWT ✓"
    : jwt && role === "anon" ? "ANON key — public, it will never work"
    : jwt ? `JWT with role "${role}"`
    : "not a JWT and not an sb_ key — probably the JWT Secret, which is the wrong field";
  return {
    present: !!trimmed,
    length: trimmed.length,
    startsWith: trimmed.slice(0, 10) + (trimmed.length > 10 ? "…" : ""),
    hadSurroundingWhitespace: k !== trimmed,
    containsQuotes: /["']/.test(k),
    isJwt: jwt, jwtRole: role, jwtProjectRef: ref,
    projectUrl: SB_URL,
    projectRefMatches: ref ? SB_URL.includes(ref) : null,
    verdict: kind,
  };
}

// Try each accepted way of presenting the key. Legacy JWTs want a Bearer token;
// the newer sb_secret_ keys are accepted on the apikey header.
async function authFetch(url: string) {
  const attempts: Array<{ how: string; headers: Record<string, string> }> = [
    { how: "apikey+Bearer", headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE } },
    { how: "apikey only", headers: { apikey: SB_SERVICE } },
    { how: "apikey+Bearer+role", headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE, "Accept-Profile": "public", "Content-Profile": "public" } },
    { how: "Authorization only", headers: { Authorization: "Bearer " + SB_SERVICE } },
  ];
  // Report EVERY attempt — showing only the last one hid why the earlier styles failed.
  const tried: string[] = [];
  for (const a of attempts) {
    let r: Response;
    try { r = await fetch(url, { headers: a.headers, cache: "no-store" }); }
    catch (e) { tried.push(`${a.how} → threw ${String((e as Error).message || e).slice(0, 80)}`); continue; }
    if (r.ok) return { ok: true as const, res: r, how: a.how };
    tried.push(`${a.how} → ${r.status} ${(await r.text().catch(() => "")).slice(0, 120)}`);
  }
  return { ok: false as const, error: tried.join("  |  ") };
}

async function listAllAuthUsers(): Promise<{ users: AuthUser[]; error?: string; how?: string }> {
  const out: AuthUser[] = [];
  let how = "";
  for (let page = 1; page <= 20; page++) {
    const a = await authFetch(`${SB_URL}/auth/v1/admin/users?page=${page}&per_page=200`);
    if (!a.ok) {
      const p = probeKey();
      return { users: out, error: `auth list failed. Key in Vercel: ${p.verdict} (length ${p.length}, starts ${p.startsWith}). Last attempt: ${a.error}` };
    }
    how = a.how;
    const j = await a.res.json();
    const users: AuthUser[] = j.users || (Array.isArray(j) ? j : []);
    out.push(...users);
    if (users.length < 200) break;
  }
  return { users: out, how };
}

async function build(request: Request, write: boolean) {
  const url = new URL(request.url);
  // ?probe=1 identifies the configured key without revealing it.
  if (url.searchParams.get("probe") === "1") return Response.json({ key: probeKey() });

  // ?schema=1 reports the table's real columns from the API's own description, which
  // works even when the table is empty (reading a row cannot tell you the shape then).
  if (url.searchParams.get("schema") === "1") {
    const a = await authFetch(`${SB_URL}/rest/v1/`);
    if (!a.ok) return Response.json({ error: a.error, key: probeKey() }, { status: 502 });
    const spec = await a.res.json().catch(() => null);
    const def = spec && spec.definitions && spec.definitions.family_accounts;
    if (!def) return Response.json({ error: "family_accounts is not described by the API — check the table exists in the public schema" }, { status: 404 });
    const props: Record<string, { type?: string; format?: string; description?: string }> = def.properties || {};
    const required: string[] = def.required || [];
    const appWrites = ["id", "name", "email", "phone", "pass", "role", "swimmer_ids", "ts"];
    const columns = Object.keys(props).map((k) => ({
      name: k,
      type: props[k].format || props[k].type,
      notNull: required.includes(k),
      hasDefault: /Default Value/i.test(props[k].description || ""),
      appSendsIt: appWrites.includes(k),
    }));
    return Response.json({
      columns,
      // These are what break an insert: cannot be null, no default, and the app never sends them.
      blockingColumns: columns.filter((c) => c.notNull && !c.hasDefault && !c.appSendsIt).map((c) => c.name),
      missingColumnsAppNeeds: appWrites.filter((c) => !props[c]),
    });
  }
  if (!haveService()) {
    return Response.json(
      { error: "server missing SUPABASE_SERVICE_ROLE_KEY — add it in Vercel → Settings → Environment Variables, then Redeploy", key: probeKey() },
      { status: 500 },
    );
  }
  const includeAll = url.searchParams.get("all") === "1";

  const { users, error, how: authHow } = await listAllAuthUsers();
  if (error) return Response.json({ error, authUsers: users.length }, { status: 502 });

  // Existing rows. Ask for * rather than named columns: if the live table is missing one
  // (it was), naming it makes the whole read fail with 42703 instead of just returning
  // what is there — which is exactly how a schema problem got mistaken for an auth problem.
  const exA = await authFetch(`${SB_URL}/rest/v1/family_accounts?select=*&limit=5000`);
  if (!exA.ok) {
    return Response.json({
      error: `could not read family_accounts. Auth listing DID work via "${authHow}" and found ${users.length} registered users, so the key is valid — the database read is what is refused.`,
      attempts: exA.error,
      authUsers: users.length,
      key: probeKey(),
    }, { status: 502 });
  }
  const existing: Array<{ email?: string; name?: string; swimmer_ids?: string[] }> = await exA.res.json();
  const have = new Set(existing.map((r) => (r.email || "").trim().toLowerCase()).filter(Boolean));

  const isStaff = (email: string) => /@vortexswimmingclub\.com$/i.test(email) || email === "ahmedmamot@gmail.com";

  const noEmail: string[] = [];
  const skippedStaff: string[] = [];
  const already: string[] = [];
  const missing: AuthUser[] = [];

  users.forEach((u) => {
    const em = (u.email || "").trim().toLowerCase();
    if (!em) { noEmail.push(u.id); return; }
    if (have.has(em)) { already.push(em); return; }
    if (!includeAll && isStaff(em)) { skippedStaff.push(em); return; }
    missing.push(u);
  });

  const rows = missing.map((u) => {
    const md = u.user_metadata || {};
    const em = (u.email || "").trim().toLowerCase();
    return {
      id: u.id,
      name: md.name || em.split("@")[0],
      email: em,
      phone: md.phone || "",
      pass: "",
      role: md.role === "swimmer" ? "swimmer" : "parent",
      swimmer_ids: Array.isArray(md.swimmer_ids) ? md.swimmer_ids : [],
      ts: Date.parse(u.created_at || "") || Date.now(),
    };
  });

  // Which columns does the live table actually have? A missing one breaks every save.
  const needed = ["id", "name", "email", "phone", "pass", "role", "swimmer_ids", "ts"];
  const columnsSeen = existing.length ? Object.keys(existing[0]) : null;
  const missingColumns = columnsSeen ? needed.filter((c) => !columnsSeen.includes(c)) : null;

  const report = {
    authUsers: users.length,
    columnsSeen,
    missingColumns,
    schemaWarning: missingColumns && missingColumns.length
      ? `family_accounts is missing: ${missingColumns.join(", ")} — run supabase/family_accounts_schema_fix.sql or saves will keep failing`
      : null,
    rowsAlreadyInTable: existing.length,
    tableContents: existing.map((r) => ({ name: r.name, email: r.email, children: (r.swimmer_ids || []).length })),
    matchedExisting: already,
    skippedStaff,
    skippedNoEmail: noEmail.length,
    toCreate: rows.map((r) => ({ name: r.name, email: r.email, children: r.swimmer_ids.length })),
  };

  if (!write) return Response.json({ dryRun: true, ...report });

  let created = 0;
  let insertError: string | null = null;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    let ok = false;
    const tried: string[] = [];
    const headerStyles: Array<{ how: string; h: Record<string, string> }> = [
      { how: "apikey+Bearer", h: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE } },
      { how: "apikey only", h: { apikey: SB_SERVICE } },
      { how: "Authorization only", h: { Authorization: "Bearer " + SB_SERVICE } },
    ];
    for (const s of headerStyles) {
      const ins = await fetch(`${SB_URL}/rest/v1/family_accounts`, {
        method: "POST",
        headers: { ...s.h, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(chunk),
      });
      if (ins.ok) { ok = true; break; }
      // Record EVERY attempt: reporting only the last one showed "No API key found",
      // which is simply what the Authorization-only style always returns, and hid the
      // real reason the first (correct) style was refused.
      tried.push(`${s.how} → ${ins.status} ${(await ins.text().catch(() => "")).slice(0, 200)}`);
    }
    if (ok) created += chunk.length;
    else if (!insertError) insertError = tried.join("  |  ");
  }

  return Response.json({ created, insertError, ...report });
}

export async function GET(request: Request) { return build(request, false); }
export async function POST(request: Request) { return build(request, true); }

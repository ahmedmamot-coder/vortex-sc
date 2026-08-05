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

import { SB_URL, SB_SERVICE, sbHeaders, haveService } from "@/lib/wearable";

type AuthUser = {
  id: string;
  email?: string;
  created_at?: string;
  user_metadata?: { name?: string; phone?: string; role?: string; swimmer_ids?: string[] };
};

async function listAllAuthUsers(): Promise<{ users: AuthUser[]; error?: string }> {
  const out: AuthUser[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(`${SB_URL}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE },
      cache: "no-store",
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      const hint =
        r.status === 401 || r.status === 403
          ? " — the key in Vercel is not the service_role key (the anon key returns this). Copy Supabase → Project Settings → API → service_role, update SUPABASE_SERVICE_ROLE_KEY in Vercel, then Redeploy."
          : "";
      return { users: out, error: `auth list failed HTTP ${r.status}${hint} ${body.slice(0, 200)}` };
    }
    const j = await r.json();
    const users: AuthUser[] = j.users || (Array.isArray(j) ? j : []);
    out.push(...users);
    if (users.length < 200) break;
  }
  return { users: out };
}

async function build(request: Request, write: boolean) {
  if (!haveService()) {
    return Response.json(
      { error: "server missing SUPABASE_SERVICE_ROLE_KEY — add it in Vercel → Settings → Environment Variables, then Redeploy" },
      { status: 500 },
    );
  }
  const includeAll = new URL(request.url).searchParams.get("all") === "1";

  const { users, error } = await listAllAuthUsers();
  if (error) return Response.json({ error, authUsers: users.length }, { status: 502 });

  // Existing rows (service-role read bypasses RLS, so this is the true contents of the table)
  const exRes = await fetch(`${SB_URL}/rest/v1/family_accounts?select=id,name,email,swimmer_ids&limit=5000`, {
    headers: sbHeaders(),
    cache: "no-store",
  });
  if (!exRes.ok) {
    const body = await exRes.text().catch(() => "");
    return Response.json({ error: `could not read family_accounts (HTTP ${exRes.status}) ${body.slice(0, 200)}` }, { status: 502 });
  }
  const existing: Array<{ email?: string; name?: string; swimmer_ids?: string[] }> = await exRes.json();
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

  const report = {
    authUsers: users.length,
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
    const ins = await fetch(`${SB_URL}/rest/v1/family_accounts`, {
      method: "POST",
      headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(chunk),
    });
    if (ins.ok) created += chunk.length;
    else if (!insertError) insertError = `insert failed HTTP ${ins.status}: ${(await ins.text().catch(() => "")).slice(0, 300)}`;
  }

  return Response.json({ created, insertError, ...report });
}

export async function GET(request: Request) { return build(request, false); }
export async function POST(request: Request) { return build(request, true); }

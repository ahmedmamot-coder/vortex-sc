// Rebuild the family_accounts table from Supabase Auth.
//
// Every parent/swimmer who registered exists as a Supabase Auth user, and the details they
// gave at sign-up (name, phone, role, linked children) were stored on that user as metadata.
// If their family_accounts row was refused at the time (the lockdown only allowed signed-in
// inserts, but registering happens before sign-in), the account is invisible to the admin
// even though the person can log in fine.
//
// This route reads the Auth user list with the service-role key and inserts a row for anyone
// missing, so the admin gets everybody back without waiting for each parent to open the app.
//
// Usage:  POST /api/family/backfill        (add ?dry=1 to preview without writing)
// Env:    SUPABASE_SERVICE_ROLE_KEY (required)

import { SB_URL, SB_SERVICE, sbHeaders, haveService } from "@/lib/wearable";

type AuthUser = {
  id: string;
  email?: string;
  created_at?: string;
  user_metadata?: { name?: string; phone?: string; role?: string; swimmer_ids?: string[] };
};

async function listAllAuthUsers(): Promise<AuthUser[]> {
  const out: AuthUser[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(`${SB_URL}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE },
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`auth list failed HTTP ${r.status}`);
    const j = await r.json();
    const users: AuthUser[] = j.users || j || [];
    out.push(...users);
    if (users.length < 200) break;
  }
  return out;
}

export async function POST(request: Request) {
  if (!haveService()) {
    return Response.json(
      { error: "server missing SUPABASE_SERVICE_ROLE_KEY — add it in Vercel → Settings → Environment Variables, then redeploy" },
      { status: 500 },
    );
  }
  const dry = new URL(request.url).searchParams.get("dry") === "1";

  let users: AuthUser[];
  try {
    users = await listAllAuthUsers();
  } catch (e) {
    return Response.json({ error: String((e as Error).message || e) }, { status: 502 });
  }

  // Who is already in the table?
  const exRes = await fetch(`${SB_URL}/rest/v1/family_accounts?select=email&limit=5000`, {
    headers: sbHeaders(),
    cache: "no-store",
  });
  if (!exRes.ok) {
    return Response.json({ error: `could not read family_accounts (HTTP ${exRes.status})` }, { status: 502 });
  }
  const existing: Array<{ email?: string }> = await exRes.json();
  const have = new Set(existing.map((r) => (r.email || "").trim().toLowerCase()).filter(Boolean));

  // Staff sign in with @vortexswimmingclub.com addresses — they are not family accounts.
  const isStaff = (email: string) => /@vortexswimmingclub\.com$/i.test(email) || email === "ahmedmamot@gmail.com";

  const missing = users.filter((u) => {
    const em = (u.email || "").trim().toLowerCase();
    return em && !have.has(em) && !isStaff(em);
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

  if (dry) {
    return Response.json({
      dryRun: true,
      authUsers: users.length,
      alreadyInTable: have.size,
      wouldCreate: rows.length,
      preview: rows.map((r) => ({ name: r.name, email: r.email, children: r.swimmer_ids.length })),
    });
  }

  let created = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const ins = await fetch(`${SB_URL}/rest/v1/family_accounts`, {
      method: "POST",
      headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(chunk),
    });
    if (ins.ok) created += chunk.length;
  }

  return Response.json({
    authUsers: users.length,
    alreadyInTable: have.size,
    created,
    note: rows.length
      ? `Recovered ${created} account(s). Any child links they chose at sign-up were restored too — check them in Admin → Family accounts.`
      : "Nothing to recover — every registered account is already in the table.",
  });
}

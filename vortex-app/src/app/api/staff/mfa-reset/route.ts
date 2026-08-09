// Remove somebody's two-step sign-in so they can set it up again (admin only).
//
// This route is the reason it is safe to require MFA of everybody. Phones are lost, replaced,
// wiped and factory-reset, and a TOTP secret lives only on the phone — so without a way back in,
// every one of 300 families is one broken screen away from being permanently locked out of
// their child's results, and the two managers are one bad afternoon away from losing the club.
//
// It is deliberately not self-service. "I have lost my phone, let me in" is exactly what an
// attacker says, so a person who already has full access has to do it, having recognised the
// human asking. That is the whole security of the escape hatch, and it is why this checks the
// caller's own token rather than trusting anything in the request body.
//
// POST /api/staff/mfa-reset
//   headers: Authorization: Bearer <the admin's own Supabase JWT>
//   body:    { email }
import { SB_URL, SB_SERVICE, haveService } from "@/lib/wearable";

const ADMIN_EMAILS = ["ahmedmamot@gmail.com", "sameh@vortexswimmingclub.com", "sameh4142@gmail.com"];

async function callerIsAdmin(request: Request): Promise<{ ok: boolean; email?: string; reason?: string }> {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, reason: "not signed in" };
  const r = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { apikey: SB_SERVICE, Authorization: "Bearer " + token },
    cache: "no-store",
  });
  if (!r.ok) return { ok: false, reason: "session is not valid — sign in again" };
  const u = (await r.json().catch(() => null)) as { email?: string; aal?: string } | null;
  const email = (u?.email || "").toLowerCase();
  if (!email) return { ok: false, reason: "session has no email" };
  if (!ADMIN_EMAILS.includes(email)) return { ok: false, email, reason: "only an admin can reset two-step sign-in" };
  return { ok: true, email };
}

export async function POST(request: Request) {
  if (!haveService())
    return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment." }, { status: 503 });

  const who = await callerIsAdmin(request);
  if (!who.ok) return Response.json({ error: who.reason }, { status: 403 });

  let body: { email?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "bad request" }, { status: 400 }); }
  const email = String(body.email || "").trim().toLowerCase();
  if (!email) return Response.json({ error: "Which account? Give the email address." }, { status: 400 });

  // Find the user. The admin list endpoint pages, and a club this size fits comfortably, but
  // pretending one page is everybody would silently fail for the last families to register.
  let userId = "";
  for (let page = 1; page <= 10 && !userId; page++) {
    const r = await fetch(`${SB_URL}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE },
      cache: "no-store",
    });
    if (!r.ok) return Response.json({ error: "could not look up the account" }, { status: 502 });
    const j = (await r.json().catch(() => null)) as { users?: Array<{ id?: string; email?: string }> } | null;
    const users = j?.users || [];
    const hit = users.find((u) => (u.email || "").toLowerCase() === email);
    if (hit?.id) userId = hit.id;
    if (users.length < 200) break;
  }
  if (!userId) return Response.json({ error: "No account with that email." }, { status: 404 });

  const fr = await fetch(`${SB_URL}/auth/v1/admin/users/${userId}/factors`, {
    headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE },
    cache: "no-store",
  });
  if (!fr.ok) return Response.json({ error: "could not read that account's factors" }, { status: 502 });
  const factors = ((await fr.json().catch(() => null)) as Array<{ id?: string }> | null) || [];

  let removed = 0;
  for (const f of factors) {
    if (!f?.id) continue;
    const d = await fetch(`${SB_URL}/auth/v1/admin/users/${userId}/factors/${f.id}`, {
      method: "DELETE",
      headers: { apikey: SB_SERVICE, Authorization: "Bearer " + SB_SERVICE },
    });
    if (d.ok) removed++;
  }

  // Worth being able to answer "who unlocked that account, and when" later.
  console.warn(`vx mfa-reset: ${who.email} removed ${removed} factor(s) for ${email}`);
  return Response.json({
    ok: true, removed,
    message: removed
      ? "Two-step sign-in removed. They will be asked to set it up again on their next sign-in."
      : "That account had no two-step sign-in set up.",
  });
}

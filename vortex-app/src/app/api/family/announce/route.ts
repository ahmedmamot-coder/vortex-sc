// The club being told that a family registered, or signed in.
//
// Both of those happen on a parent's phone, and both used to be written from it: one row into
// signup_alerts, plus a push to `{role:'staff'}`. Neither could work, and neither said so.
//
// signup_alerts is staff-only — read and write — in security_4_roles.sql, and correctly: it is
// the club's own feed. So the insert came back 403 "new row violates row-level security policy",
// which the app files as a row the database will never take, and a red banner appeared on the
// parent's phone counting a record that was never theirs. /api/push/send requires staff for a
// reason of its own (anyone can create a family login, and the body takes `all: true`), so the
// push was refused too. The net effect: every family sign-in put one more record on that
// parent's banner, and the club heard nothing at all.
//
// The write belongs on the server, because the thing being written belongs to the club. What the
// caller supplies is which of the two things happened and nothing else — the name, the address
// and the children are read here from the caller's own family_accounts row, so an alert cannot
// say anything a parent typed into it, and cannot be about anybody else's family.
//
// POST /api/family/announce   body: { kind: "register" | "sign-in" }
//   → { ok: true, alert: { title, body } }

import { SB_URL, SB_SERVICE, haveService } from "@/lib/wearable";
import { requireUser } from "@/lib/callerAuth";

export const maxDuration = 15;

function svc() {
  return {
    apikey: SB_SERVICE,
    Authorization: "Bearer " + SB_SERVICE,
    "Content-Type": "application/json",
  };
}

type FamilyRow = { id?: string; name?: string; email?: string; phone?: string; role?: string; swimmer_ids?: unknown };

/** "preteam::r3" and "r3" both name r3 — the family record stores the first, club_state the second. */
function bareId(id: unknown): string {
  return String(id ?? "").split("::").pop() || "";
}

/**
 * The children's names, read from the roster the club actually holds.
 *
 * Names only, and only for children already linked to this account: the alert is for the club,
 * and "Nancy Abdullah signed in" without saying whose parent she is was the line coaches asked
 * about every time.
 */
async function childNames(ids: string[]): Promise<string> {
  if (!ids.length) return "";
  try {
    const r = await fetch(`${SB_URL}/rest/v1/club_state?select=value&key=eq.vx_roster_edits`, {
      headers: svc(),
      cache: "no-store",
    });
    if (!r.ok) return "";
    const rows = (await r.json().catch(() => null)) as Array<{ value?: unknown }> | null;
    const doc = (Array.isArray(rows) && rows[0] && rows[0].value) as
      | { added?: Record<string, Array<Record<string, unknown>>>; edits?: Record<string, Record<string, Record<string, unknown>>> }
      | undefined;
    if (!doc) return "";
    const want = new Set(ids);
    const found: string[] = [];
    for (const list of Object.values(doc.added || {})) {
      for (const sw of list || []) {
        if (want.has(bareId(sw?.id)) && typeof sw?.name === "string") found.push(sw.name);
      }
    }
    for (const bySquad of Object.values(doc.edits || {})) {
      for (const [swid, patch] of Object.entries(bySquad || {})) {
        if (want.has(bareId(swid)) && typeof patch?.name === "string") found.push(patch.name as string);
      }
    }
    return [...new Set(found)].join(", ");
  } catch {
    return "";
  }
}

export async function POST(request: Request) {
  if (!haveService()) {
    return Response.json({ error: "server missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });
  }

  const who = await requireUser(request);
  if (!who.ok) return who.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  // Two values, and nothing else this route will act on. A free-text alert would be a way for
  // anyone with a family login to write into the club's own feed.
  const kind = body.kind === "register" ? "register" : "sign-in";

  const famRes = await fetch(
    `${SB_URL}/rest/v1/family_accounts?select=id,name,email,phone,role,swimmer_ids&email=eq.${encodeURIComponent(
      who.caller.email,
    )}&limit=1`,
    { headers: svc(), cache: "no-store" },
  );
  if (!famRes.ok) return Response.json({ error: "could not look up this account" }, { status: 502 });
  const rows = (await famRes.json().catch(() => null)) as FamilyRow[] | null;
  if (!Array.isArray(rows) || !rows.length) {
    // Staff sign in through their own screen and their own alerts; this route is not for them,
    // and neither is it an error worth a red answer.
    return Response.json({ ok: false, reason: "no family account for this sign-in" }, { status: 403 });
  }

  const fam = rows[0];
  const name = String(fam.name || "").trim() || who.caller.email;
  const phone = String(fam.phone || "").trim();
  const ids = (Array.isArray(fam.swimmer_ids) ? fam.swimmer_ids : []).map(bareId).filter(Boolean);
  const kids = await childNames(ids);

  const isReg = kind === "register";
  const title = isReg
    ? "New " + (fam.role === "swimmer" ? "swimmer" : "parent") + " sign-up"
    : "Family sign-in";
  const line = isReg
    ? name + " registered (" + who.caller.email + (phone ? " · " + phone : "") + ")" + (kids ? " for " + kids : "")
    : name + " signed in (" + who.caller.email + ")" + (kids ? " · " + kids : ids.length ? "" : " · no child linked");

  const alertRow = {
    id: (isReg ? "sa" : "li") + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    icon: isReg ? "user-plus" : "log-in",
    title,
    body: line,
    ts: Date.now(),
  };

  const ins = await fetch(SB_URL + "/rest/v1/signup_alerts", {
    method: "POST",
    headers: { ...svc(), Prefer: "return=minimal" },
    body: JSON.stringify([alertRow]),
  });
  if (!ins.ok) {
    const said = await ins.text().catch(() => "");
    return Response.json({ error: "could not record the alert", said: said.slice(0, 300) }, { status: 502 });
  }

  return Response.json({ ok: true, alert: { title, body: line } }, { headers: { "Cache-Control": "no-store" } });
}

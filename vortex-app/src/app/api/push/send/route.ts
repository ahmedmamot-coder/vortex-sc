import webpush from "web-push";

// Public Supabase values (same as the client). Overridable via env.
const SB_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qhrpwiakobgcxfmcoyfg.supabase.co";
const SB_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFocnB3aWFrb2JnY3hmbWNveWZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NTgyMzQsImV4cCI6MjA5OTQzNDIzNH0.NVmLPF99O9M6rj-Srp3tP-ZkuhzIea0jSN4r0asW1eI";
// Prefer the service-role key (secret) for reading/pruning subscriptions if provided.
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SB_ANON;

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@vortexswimmingclub.com";

type Sub = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  role?: string;
  swimmer_ids?: unknown;
};

export async function POST(request: Request) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return Response.json({ error: "push not configured (missing VAPID env keys)" }, { status: 500 });
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  // Only a logged-in user (their Supabase JWT) may trigger notifications.
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });
  const who = await fetch(SB_URL + "/auth/v1/user", {
    headers: { apikey: SB_ANON, Authorization: "Bearer " + token },
  });
  if (!who.ok) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const swimmerIds: string[] = Array.isArray(body.swimmerIds) ? body.swimmerIds.map(String) : [];
  const role = typeof body.role === "string" ? body.role : "";
  const all = !!body.all;
  const title = typeof body.title === "string" ? body.title : "Vortex SC";
  const message = typeof body.message === "string" ? body.message : "";
  const url = typeof body.url === "string" ? body.url : "/";

  const res = await fetch(SB_URL + "/rest/v1/push_subscriptions?select=*", {
    headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY },
  });
  const subs: Sub[] = res.ok ? await res.json() : [];
  const targetSet = new Set(swimmerIds);
  const chosen = subs.filter((s) => {
    if (all) return true;
    if (role && s.role === role) return true;
    if (
      targetSet.size &&
      Array.isArray(s.swimmer_ids) &&
      (s.swimmer_ids as unknown[]).some((x) => targetSet.has(String(x)))
    )
      return true;
    return false;
  });

  const payload = JSON.stringify({ title, body: message, url });
  let sent = 0;
  let pruned = 0;
  await Promise.all(
    chosen.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        );
        sent++;
      } catch (err: unknown) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          try {
            await fetch(
              SB_URL + "/rest/v1/push_subscriptions?id=eq." + encodeURIComponent(s.id),
              { method: "DELETE", headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY } }
            );
            pruned++;
          } catch {}
        }
      }
    })
  );

  return Response.json({ sent, pruned, matched: chosen.length });
}

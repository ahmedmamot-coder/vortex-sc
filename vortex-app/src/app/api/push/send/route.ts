import webpush from "web-push";
import { requireStaff } from "@/lib/callerAuth";
import { sendApns, apnsConfigured } from "@/lib/apns";

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
  /** "ios" for a device registered through the native app; absent for a browser. */
  platform?: string;
  apns_token?: string;
};

/** An iPhone registered through the app, rather than a browser holding a Web Push subscription. */
function isApns(s: Sub): boolean {
  return s.platform === "ios" || !!s.apns_token || String(s.endpoint || "").startsWith("apns:");
}
function apnsTokenOf(s: Sub): string {
  return s.apns_token || String(s.endpoint || "").replace(/^apns:/, "");
}

export async function POST(request: Request) {
  // Either transport on its own is a working configuration: a club with only the web app has no
  // APNs key, and an iOS-only future would have no VAPID pair. Refusing unless BOTH are present
  // would take the whole feature down for the club that has one of them.
  const haveWeb = !!(VAPID_PUBLIC && VAPID_PRIVATE);
  if (!haveWeb && !apnsConfigured()) {
    return Response.json(
      { error: "push not configured: set the VAPID keys, the APNS_* keys, or both" },
      { status: 500 },
    );
  }
  if (haveWeb) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  // Only club staff may trigger notifications.
  //
  // This used to check that the caller was signed in and nothing more. Anyone can create a family
  // login — that is what registration is — so "signed in" included every parent, and the body
  // takes `all: true`. One registration was the whole distance between a stranger and a
  // notification on 304 families' phones.
  const who = await requireStaff(request);
  if (!who.ok) return who.response;

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
  let sentIos = 0;
  let pruned = 0;

  async function prune(id: string) {
    try {
      await fetch(SB_URL + "/rest/v1/push_subscriptions?id=eq." + encodeURIComponent(id), {
        method: "DELETE",
        headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY },
      });
      pruned++;
    } catch {
      /* the notification still went; a row that could not be pruned is tomorrow's problem */
    }
  }

  await Promise.all(
    chosen.map(async (s) => {
      // An iPhone registered through the app has no Web Push subscription to send to — the
      // endpoint is an APNs device token wearing the same column.
      if (isApns(s)) {
        if (!apnsConfigured()) return;
        const r = await sendApns(apnsTokenOf(s), { title, body: message, url });
        if (r.ok) sentIos++;
        else if (r.gone) await prune(s.id);
        return;
      }
      if (!haveWeb) return;
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        );
        sent++;
      } catch (err: unknown) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) await prune(s.id);
      }
    })
  );

  return Response.json({ sent: sent + sentIos, web: sent, ios: sentIos, pruned, matched: chosen.length });
}

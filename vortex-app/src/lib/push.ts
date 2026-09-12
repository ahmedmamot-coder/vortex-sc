// Shared server-only push sender: one place that turns a target + a message into notifications
// on real devices, over Web Push (browsers, installed PWAs) and APNs (the native iOS app).
//
// This used to live entirely inside /api/push/send. The route is still the door a signed-in
// staff device knocks on, but the automatic birthday cron (/api/birthdays/run) needs to send the
// same way without a staff token in hand, so the sending itself is here and both callers share it.
// Never import this into browser code — it holds the service-role key path.
import webpush from "web-push";
import { sendApns, apnsConfigured } from "@/lib/apns";

// Public Supabase values (same as the client). Overridable via env.
const SB_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qhrpwiakobgcxfmcoyfg.supabase.co";
const SB_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFocnB3aWFrb2JnY3hmbWNveWZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NTgyMzQsImV4cCI6MjA5OTQzNDIzNH0.NVmLPF99O9M6rj-Srp3tP-ZkuhzIea0jSN4r0asW1eI";
// Prefer the service-role key (secret) for reading/pruning subscriptions if provided.
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SB_ANON;

// The browser subscribes with a fixed public key baked into the app (this.VAPID_PUBLIC in
// proto.html). Web Push rejects any send whose VAPID public key does not match the one the
// subscription was made with, so the server MUST use the same key — defaulting to it here means a
// missing or mismatched VAPID_PUBLIC_KEY env can never silently break push for every browser at
// once. The private key is the secret half and has no default: it must be the pair of this key,
// supplied via VAPID_PRIVATE_KEY, or web push stays off.
const VAPID_PUBLIC =
  process.env.VAPID_PUBLIC_KEY ||
  "BPnAfmRju94v7v00p3aq6W3hf3Y89au054VeOEn0LnQa9yLT_qqzwOHNkosYkOItc3S2WPEl676HR4S3vhpdUOE";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@vortexswimmingclub.com";

export type Sub = {
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

export type PushTarget = { all?: boolean; role?: string; swimmerIds?: string[] };
export type PushPayload = { title: string; message: string; url?: string };
export type PushResult = {
  ok: boolean;
  error?: string;
  sent: number;
  web: number;
  ios: number;
  pruned: number;
  matched: number;
};

/** Whether Web Push (browsers/PWAs) can send — needs both halves of the VAPID pair. */
export function webPushConfigured(): boolean {
  return !!(VAPID_PUBLIC && VAPID_PRIVATE);
}

/** Which transports are ready. Booleans only — never a key value. */
export function pushTransports(): { web: boolean; ios: boolean } {
  return { web: webPushConfigured(), ios: apnsConfigured() };
}

/** Web Push, APNs, or both — as long as one transport is configured, sending works. */
export function pushConfigured(): boolean {
  return webPushConfigured() || apnsConfigured();
}

/** An iPhone registered through the app, rather than a browser holding a Web Push subscription. */
export function isApns(s: Sub): boolean {
  return s.platform === "ios" || !!s.apns_token || String(s.endpoint || "").startsWith("apns:");
}
function apnsTokenOf(s: Sub): string {
  return s.apns_token || String(s.endpoint || "").replace(/^apns:/, "");
}

/** Which subscriptions a target selects, out of every device that has opted in. */
export function chooseSubs(subs: Sub[], target: PushTarget): Sub[] {
  const targetSet = new Set((target.swimmerIds || []).map(String));
  const role = typeof target.role === "string" ? target.role : "";
  const all = !!target.all;
  return subs.filter((s) => {
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
}

/**
 * Send one message to every device a target selects.
 *
 * Either transport on its own is a working configuration: a club with only the web app has no
 * APNs key, and an iOS-only future would have no VAPID pair. A dead browser subscription (404/410)
 * or a dead APNs token is pruned so the list does not grow stale forever.
 */
export async function sendPush(target: PushTarget, payload: PushPayload): Promise<PushResult> {
  const haveWeb = !!(VAPID_PUBLIC && VAPID_PRIVATE);
  if (!haveWeb && !apnsConfigured()) {
    return {
      ok: false,
      error: "push not configured: set the VAPID keys, the APNS_* keys, or both",
      sent: 0,
      web: 0,
      ios: 0,
      pruned: 0,
      matched: 0,
    };
  }
  if (haveWeb) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  const title = payload.title || "Vortex SC";
  const message = payload.message || "";
  const url = payload.url || "/";

  const res = await fetch(SB_URL + "/rest/v1/push_subscriptions?select=*", {
    headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY },
    cache: "no-store",
  });
  const subs: Sub[] = res.ok ? await res.json() : [];
  const chosen = chooseSubs(subs, target);

  const body = JSON.stringify({ title, body: message, url });
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
          body,
        );
        sent++;
      } catch (err: unknown) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) await prune(s.id);
      }
    }),
  );

  return { ok: true, sent: sent + sentIos, web: sent, ios: sentIos, pruned, matched: chosen.length };
}

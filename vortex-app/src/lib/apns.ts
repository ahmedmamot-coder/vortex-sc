// Sending a notification to an iPhone.
//
// Web Push does not exist inside a WKWebView, so the iOS app registers with APNs instead and the
// club ends up with two kinds of subscriber in one table. This is the APNs half; web-push is
// still the right thing for the Android TWA, for desktop, and for anyone who installed the PWA
// from Safari, so /api/push/send fans out to both rather than replacing one with the other.
//
// Token-based auth (a .p8 key) rather than certificates: certificates expire once a year and the
// club would find out on the morning nobody got the notification about the cancelled session.
// The JWT is signed here with Node's own crypto — one ES256 signature is not worth a dependency.
//
// The signing token is valid for an hour and Apple rejects one refreshed more than once every 20
// minutes, so it is cached and reused. Recreating it per send is the documented way to get
// throttled with a 403 that reads like a bad key.

import { createSign } from "node:crypto";

const KEY = (process.env.APNS_KEY_P8 || "").replace(/\\n/g, "\n");
const KEY_ID = process.env.APNS_KEY_ID || "";
const TEAM_ID = process.env.APNS_TEAM_ID || "";
const BUNDLE_ID = process.env.APNS_BUNDLE_ID || "com.vortexswimmingclub.app";
// Sandbox for TestFlight-from-Xcode builds, production for App Store and TestFlight uploads.
const HOST =
  (process.env.APNS_ENV || "production") === "sandbox"
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";

export function apnsConfigured(): boolean {
  return !!(KEY && KEY_ID && TEAM_ID);
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let cached: { token: string; madeAt: number } | null = null;

function providerToken(): string {
  // Apple's guidance: refresh no more often than every 20 minutes, and no less often than hourly.
  if (cached && Date.now() - cached.madeAt < 30 * 60 * 1000) return cached.token;

  const header = b64url(JSON.stringify({ alg: "ES256", kid: KEY_ID }));
  const claims = b64url(JSON.stringify({ iss: TEAM_ID, iat: Math.floor(Date.now() / 1000) }));
  const signer = createSign("SHA256");
  signer.update(`${header}.${claims}`);
  signer.end();
  const sig = signer.sign({ key: KEY, dsaEncoding: "ieee-p1363" });
  const token = `${header}.${claims}.${b64url(sig)}`;
  cached = { token, madeAt: Date.now() };
  return token;
}

export type ApnsResult = { ok: boolean; status: number; reason?: string; gone?: boolean };

/**
 * One notification to one device.
 *
 * `gone` is the answer that matters operationally: 410 means the app was deleted, and 400
 * BadDeviceToken means the token was never valid for this environment. Both mean the row should
 * be pruned, exactly as a 404/410 from web-push does — otherwise the table fills with devices
 * that no longer exist and every send gets slower.
 */
export async function sendApns(
  deviceToken: string,
  payload: { title: string; body: string; url?: string; badge?: number },
): Promise<ApnsResult> {
  if (!apnsConfigured()) return { ok: false, status: 0, reason: "apns-not-configured" };

  const body = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: "default",
      badge: payload.badge,
      "thread-id": "vortex",
    },
    url: payload.url || "/",
  });

  let r: Response;
  try {
    r = await fetch(`${HOST}/3/device/${encodeURIComponent(deviceToken)}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${providerToken()}`,
        "apns-topic": BUNDLE_ID,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      },
      body,
    });
  } catch (e) {
    return { ok: false, status: 0, reason: (e as Error)?.message || "network" };
  }

  if (r.ok) return { ok: true, status: r.status };

  const text = await r.text().catch(() => "");
  let reason = text.slice(0, 200);
  try {
    reason = (JSON.parse(text) as { reason?: string })?.reason || reason;
  } catch {
    /* not JSON — keep the raw text */
  }
  const gone = r.status === 410 || reason === "BadDeviceToken" || reason === "Unregistered";
  // A stale provider token answers 403 ExpiredProviderToken; drop the cache so the next send
  // makes a new one rather than repeating the same rejected signature.
  if (r.status === 403) cached = null;
  return { ok: false, status: r.status, reason, gone };
}

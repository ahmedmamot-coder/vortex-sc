import { requireStaff } from "@/lib/callerAuth";
import { sendPush, pushConfigured, type PushTarget } from "@/lib/push";

export async function POST(request: Request) {
  // Either transport on its own is a working configuration: a club with only the web app has no
  // APNs key, and an iOS-only future would have no VAPID pair. Refusing unless BOTH are present
  // would take the whole feature down for the club that has one of them.
  if (!pushConfigured()) {
    return Response.json(
      { error: "push not configured: set the VAPID keys, the APNS_* keys, or both" },
      { status: 500 },
    );
  }

  // Only club staff may trigger notifications.
  //
  // This used to check that the caller was signed in and nothing more. Anyone can create a family
  // login — that is what registration is — so "signed in" included every parent, and the body
  // takes `all: true`. One registration was the whole distance between a stranger and a
  // notification on 304 families' phones.
  const who = await requireStaff(request);
  if (!who.ok) return who.response;

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const target: PushTarget = {
    swimmerIds: Array.isArray(body.swimmerIds) ? body.swimmerIds.map(String) : [],
    role: typeof body.role === "string" ? body.role : "",
    all: !!body.all,
  };
  const title = typeof body.title === "string" ? body.title : "Vortex SC";
  const message = typeof body.message === "string" ? body.message : "";
  const url = typeof body.url === "string" ? body.url : "/";

  const r = await sendPush(target, { title, message, url });
  if (!r.ok) return Response.json({ error: r.error }, { status: 500 });
  return Response.json({ sent: r.sent, web: r.web, ios: r.ios, pruned: r.pruned, matched: r.matched });
}

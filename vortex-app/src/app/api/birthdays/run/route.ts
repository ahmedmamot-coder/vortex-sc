// Wish today's birthday swimmers automatically — every day, whether or not anyone opens the app.
//
// The app already knows how to wish a swimmer: it writes a message into the family thread, drops a
// notification for the family and for the managers, and pushes to both. But it only ever did that
// when a STAFF device opened the app (birthdayRun() in proto.html runs six seconds after load,
// once per staff session). A child whose birthday fell on a day no coach opened the app was never
// wished. This route does the same work on a Vercel cron, so the greeting no longer depends on
// somebody happening to open a phone.
//
// It reaches the same data the app syncs (the club_state document that holds every date of birth)
// and writes the same rows, keyed off the same vx_bday_sent guard — so it and the app can never
// wish the same child twice in a year, and it is safe to run every morning.
//
// Runs daily via the Vercel cron (see vercel.json). Optional guard: set BIRTHDAY_CRON_SECRET and
// pass it as header x-cron-secret or ?key=; Vercel's own CRON_SECRET bearer is honoured too.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SB_URL, SB_SERVICE, haveService, serviceKeyRole, serviceKeyWorks } from "@/lib/wearable";
import { sendPush, pushConfigured, pushTransports } from "@/lib/push";
import {
  parseBaseRoster,
  buildSquads,
  reconstructRoster,
  birthdaysToday,
  todayISOInZone,
  type BaseRoster,
  type RosterEdits,
  type SquadOverlay,
} from "@/lib/birthdays";

export const maxDuration = 60;

// The club is in Doha. "Today" is Doha's today, not the server's UTC day, or a child born on the
// 12th could be wished on the 11th or the 13th depending on where the function happened to run.
const CLUB_TZ = "Asia/Qatar";

function svc(extra?: Record<string, string>) {
  return {
    apikey: SB_SERVICE,
    Authorization: "Bearer " + SB_SERVICE,
    "Content-Type": "application/json",
    ...(extra || {}),
  };
}

/** One club_state document by key, unwrapped whether PostgREST hands it back as JSON or a string. */
async function readState<T>(key: string): Promise<T | null> {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/club_state?select=value&key=eq.${encodeURIComponent(key)}`, {
      headers: svc(),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const rows = (await r.json().catch(() => null)) as Array<{ value?: unknown }> | null;
    if (!Array.isArray(rows) || !rows.length) return null;
    const v = rows[0].value;
    if (v == null) return null;
    return (typeof v === "string" ? JSON.parse(v) : v) as T;
  } catch {
    return null;
  }
}

/** Upsert a club_state document, exactly the way the app does (merge-duplicates on the key). */
async function writeState(key: string, value: unknown): Promise<boolean> {
  try {
    const r = await fetch(SB_URL + "/rest/v1/club_state", {
      method: "POST",
      headers: svc({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// The base seed (window.VX_ROSTER) ships as a static asset. Read it off disk when the function has
// it, and fall back to fetching it from this same deployment when it does not.
async function loadBaseRoster(origin: string): Promise<BaseRoster> {
  try {
    const p = path.join(process.cwd(), "public", "assets", "roster.js");
    const js = await readFile(p, "utf8");
    const r = parseBaseRoster(js);
    if (Object.keys(r).length) return r;
  } catch {
    /* not on disk in this runtime — try the network copy below */
  }
  try {
    const res = await fetch(origin + "/assets/roster.js", { cache: "no-store" });
    if (res.ok) return parseBaseRoster(await res.text());
  } catch {
    /* fall through to empty */
  }
  return {};
}

let _notifSeq = 0;
function notifId(): string {
  _notifSeq += 1;
  return "notif" + Date.now().toString(36) + "_cron" + _notifSeq;
}

type NotifRec = { id: string; audience: string; icon: string; title: string; body: string; at: string; read: boolean };

async function run(request: Request): Promise<Response> {
  // Optional guard. When BIRTHDAY_CRON_SECRET (or Vercel's CRON_SECRET) is set, the request must
  // carry it; when neither is set the route is open, the same as the wearable sync cron.
  const url = new URL(request.url);
  const secret = process.env.BIRTHDAY_CRON_SECRET || process.env.CRON_SECRET || "";
  if (secret) {
    const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const given = request.headers.get("x-cron-secret") || url.searchParams.get("key") || bearer;
    if (given !== secret) return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const forced = url.searchParams.get("date");
  const dry = url.searchParams.get("dry") === "1";

  // Push may not be configured yet, but the greeting has three channels — the family thread, the
  // in-app feed, and push — and the first two work regardless. So the run goes ahead and does what
  // it can rather than doing nothing; whether push actually landed is reported back below.
  const havePush = pushConfigured();

  // What is and isn't configured — booleans only, never a key value. This is what ?dry=1 reports,
  // so one call confirms the environment before the first real send. serviceOk asks Supabase
  // whether the key actually carries service-role rights (the anon key in that slot passes every
  // presence check and then reads and writes nothing).
  const transports = pushTransports();
  const service = haveService();
  const serviceOk = service ? await serviceKeyWorks() : false;
  const config = {
    service,
    serviceRole: serviceKeyRole(),
    serviceOk,
    webPush: transports.web,
    iosPush: transports.ios,
    secretGuard: !!secret,
    clubTimeZone: CLUB_TZ,
  };
  const missing: string[] = [];
  if (!service) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  else if (serviceOk === false)
    missing.push(
      "SUPABASE_SERVICE_ROLE_KEY is set but does not carry service-role rights" +
        (config.serviceRole === "anon" ? " — it holds the publishable/anon key" : "") +
        ". The birthday run can read nothing and write nothing.",
    );
  if (!havePush) missing.push("push transport: set VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY, and/or the APNS_* keys");
  else if (!transports.web) missing.push("web push off: set VAPID_PRIVATE_KEY (paired with the app's public key) for browsers/PWAs");

  // Without the service key we cannot read the roster at all — but a dry run should still report
  // the config so it can be used to diagnose exactly this. A real run has nothing it can do.
  if (!service || serviceOk === false) {
    if (dry) return Response.json({ ok: true, dry: true, config, missing }, { headers: { "cache-control": "no-store" } });
    return Response.json({ error: missing[0] || "server not configured", config, missing }, { status: 500 });
  }

  const today = todayISOInZone(CLUB_TZ);
  // ?date=YYYY-MM-DD forces a day, for testing and for sending one the club missed. ?dry=1 reports
  // who would be wished without writing or pushing anything.
  const day = forced && /^\d{4}-\d{2}-\d{2}$/.test(forced) ? forced : today;

  const [baseRoster, rosterEdits, squadEdits, brand, bdaySentRaw, notifsRaw] = await Promise.all([
    loadBaseRoster(url.origin),
    readState<RosterEdits>("vx_roster_edits"),
    readState<SquadOverlay>("vx_squads"),
    readState<{ clubName?: string }>("vx_brand"),
    readState<Record<string, string>>("vx_bday_sent"),
    readState<NotifRec[]>("vx_notifications"),
  ]);

  const squads = buildSquads(squadEdits);
  const roster = reconstructRoster(baseRoster, squads, rosterEdits);
  const club = (brand && brand.clubName) || "Vortex Swimming Club";

  const dueYear = day.slice(0, 4);
  const sent: Record<string, string> = bdaySentRaw && typeof bdaySentRaw === "object" ? { ...bdaySentRaw } : {};
  const due = birthdaysToday(roster, day).filter((sw) => sw.id && sent[sw.id] !== dueYear);

  if (dry) {
    return Response.json(
      {
        ok: true,
        dry: true,
        day,
        config,
        missing,
        swimmers: roster.length,
        due: due.map((s) => ({ id: s.id, name: s.name, squad: s.squadName, turning: s.turning })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  if (!due.length) {
    return Response.json({ ok: true, day, swimmers: roster.length, wished: 0 });
  }

  // Claim first, then send — the same order the app uses, so a device opening mid-run stands down
  // instead of wishing the same child a second time. The year is stamped for the calendar year of
  // the day being processed.
  due.forEach((sw) => {
    sent[sw.id] = dueYear;
  });
  const claimed = await writeState("vx_bday_sent", sent);
  if (!claimed) {
    return Response.json({ error: "could not claim vx_bday_sent — nothing was sent" }, { status: 502 });
  }

  const newNotifs: NotifRec[] = [];
  const messages: Array<Record<string, unknown>> = [];
  const nowISO = new Date().toISOString();
  let pushedFamily = 0;
  let pushedStaff = 0;

  for (const sw of due) {
    const first = String(sw.name || "").trim().split(/\s+/)[0] || "there";
    const turning = sw.turning;
    const title = "Happy birthday, " + first + "! 🎂";
    const body =
      "Everyone at " + club + " wishes you a brilliant day" +
      (turning != null ? " — " + turning + " today" : "") +
      ". كل عام وأنت بخير!";

    // The message in the family thread they can read and reply to.
    messages.push({
      id: "fm" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      swimmer_id: sw.id,
      sender: "staff",
      from_name: club,
      from_photo: "",
      body: title + "\n" + body,
      set_text: "",
      video: "",
      ts: Date.now(),
    });

    // Notifications: one for the family, one for the managers. Same audiences and wording the app
    // uses, so the feed reads identically whichever wished them.
    newNotifs.push({ id: notifId(), audience: "family_sw:" + sw.id, icon: "cake", title, body, at: nowISO, read: false });
    newNotifs.push({
      id: notifId(),
      audience: "admin",
      icon: "cake",
      title: sw.name + "’s birthday" + (turning != null ? " — " + turning + " today" : ""),
      body: (sw.squadName || "") + " · the club’s message has gone to them and their parents",
      at: nowISO,
      read: false,
    });

    // Push to the family's devices, and to the coaches so someone can say it in person.
    try {
      const rf = await sendPush({ swimmerIds: [sw.id] }, { title, message: body, url: "/" });
      pushedFamily += rf.sent;
    } catch {
      /* the message and notification still landed; the push is best-effort */
    }
    try {
      const rs = await sendPush(
        { role: "staff" },
        {
          title: "Birthday today: " + sw.name,
          message: (sw.squadName || "") + (turning != null ? " · turning " + turning : ""),
          url: "/",
        },
      );
      pushedStaff += rs.sent;
    } catch {
      /* best-effort */
    }
  }

  // Write the family messages (one batch) and prepend the notifications to the shared feed, capped
  // at 600 the same as the app.
  let messagesOk = true;
  if (messages.length) {
    try {
      const r = await fetch(SB_URL + "/rest/v1/family_messages", {
        method: "POST",
        headers: svc({ Prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify(messages),
      });
      messagesOk = r.ok;
    } catch {
      messagesOk = false;
    }
  }

  const existing = Array.isArray(notifsRaw) ? notifsRaw : [];
  const merged = [...newNotifs, ...existing].slice(0, 600);
  const notifsOk = await writeState("vx_notifications", merged);

  return Response.json({
    ok: true,
    day,
    swimmers: roster.length,
    wished: due.length,
    who: due.map((s) => s.name),
    havePush,
    pushedFamily,
    pushedStaff,
    messagesOk,
    notifsOk,
  });
}

export async function GET(request: Request) {
  return run(request);
}
export async function POST(request: Request) {
  return run(request);
}

// Put the whole roster back to a chosen night.
//
// Everything else in this folder refuses to change how many swimmers there are, and that was the
// right instinct: the repair that DID rewrite the roster took this club from 344 swimmers to 272
// with every date gone. But it leaves nowhere to go when the count itself is what is wrong — the
// club spent an afternoon at 317 swimmers and 106 missing dates, knowing the night before had 304
// and 6, with the file that says so sitting in the bucket.
//
// So this one replaces the overlay outright, and pays for that with the only guards that matter:
//
//   * it says what the result will be BEFORE anything is written — the swimmer count, the dates —
//     and refuses unless the caller passes back that exact count
//   * it writes today's overlay to the bucket first, under its own name, so this is undoable by
//     running it again against that file
//   * it refuses a backup that would empty the club, whatever the caller confirms
//
//   GET  /api/backup/restore-roster?file=backup-2026-08-14.json   → what it would do
//   POST /api/backup/restore-roster?file=backup-2026-08-14.json&confirm=304

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { guard, svc, BUCKET, readBackup, clubStateKey, dobsIn, shapeOf, type RosterEdits } from "@/lib/backupStore";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qhrpwiakobgcxfmcoyfg.supabase.co";

type Swimmer = { id?: string; name?: string; dob?: string };

function parseRoster(src: string): Record<string, Swimmer[]> | null {
  const at = src.indexOf("=");
  if (at < 0) return null;
  try {
    return JSON.parse(src.slice(at + 1).replace(/;\s*$/, "")) as Record<string, Swimmer[]>;
  } catch {
    return null;
  }
}

// public/ is served by the CDN and is not in the serverless bundle, so this is fetched from the
// deployment. The disk read is what works on a laptop.
async function baseRoster(origin: string): Promise<Record<string, Swimmer[]> | null> {
  try {
    const r = await fetch(origin + "/assets/roster.js", { cache: "no-store" });
    if (r.ok) {
      const got = parseRoster(await r.text());
      if (got) return got;
    }
  } catch {
    /* fall through */
  }
  try {
    return parseRoster(await readFile(join(process.cwd(), "public", "assets", "roster.js"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * How many swimmers an overlay actually produces on top of the club's roster — which is the
 * number on the screen, and the only one worth confirming against. shapeOf counts entries in the
 * overlay; this counts swimmers.
 */
function swimmerCount(base: Record<string, Swimmer[]>, ed: RosterEdits | null): number {
  let n = 0;
  for (const [squad, list] of Object.entries(base || {})) {
    const gone = (ed && ed.deleted && ed.deleted[squad]) || {};
    for (const sw of list || []) if (!(sw && sw.id && gone[sw.id])) n++;
  }
  for (const [squad, list] of Object.entries((ed && ed.added) || {})) {
    const gone = (ed && ed.deleted && ed.deleted[squad]) || {};
    for (const sw of list || []) if (!(sw && typeof sw.id === "string" && gone[sw.id])) n++;
  }
  return n;
}

async function readLive(): Promise<RosterEdits | null> {
  const r = await fetch(SB_URL + "/rest/v1/club_state?select=value&key=eq.vx_roster_edits", { headers: svc() });
  if (!r.ok) return null;
  const rows = (await r.json()) as Array<{ value?: unknown }>;
  const v = rows && rows[0] ? rows[0].value : null;
  if (v == null) return null;
  return (typeof v === "string" ? JSON.parse(v) : v) as RosterEdits;
}

async function plan(request: Request, file: string) {
  const snap = await readBackup(file);
  if (!snap) return { error: "that backup could not be read" as const };
  const from = clubStateKey(snap, "vx_roster_edits") as RosterEdits | null;
  if (!from || typeof from !== "object") return { error: "that backup holds no roster" as const };

  const base = await baseRoster(new URL(request.url).origin);
  if (!base) return { error: "could not read the bundled roster" as const };

  const live = await readLive();
  const would = swimmerCount(base, from);
  const now = swimmerCount(base, live);
  return {
    file,
    willBe: { swimmers: would, dates: Object.keys(dobsIn(from)).length, shape: shapeOf(from) },
    isNow: { swimmers: now, dates: Object.keys(dobsIn(live)).length, shape: shapeOf(live) },
    from,
    live,
  };
}

export async function GET(request: Request) {
  const bad = guard(request);
  if (bad) return bad;
  const head = { "cache-control": "no-store" } as const;
  const file = new URL(request.url).searchParams.get("file") || "";
  if (!file) return Response.json({ error: "pass ?file=<one of /api/backup/list>" }, { status: 400, headers: head });

  const p = await plan(request, file);
  if ("error" in p) return Response.json({ error: p.error }, { status: 502, headers: head });
  return Response.json(
    {
      file: p.file,
      willBe: p.willBe,
      isNow: p.isNow,
      willNotDo: ["run without being told the exact swimmer count above", "throw today's roster away without keeping a copy of it"],
      next: `POST /api/backup/restore-roster?file=${encodeURIComponent(file)}&confirm=${p.willBe.swimmers}`,
    },
    { headers: head },
  );
}

export async function POST(request: Request) {
  const bad = guard(request);
  if (bad) return bad;
  const head = { "cache-control": "no-store" } as const;
  const q = new URL(request.url).searchParams;
  const file = q.get("file") || "";
  const confirm = parseInt(q.get("confirm") || "", 10);
  if (!file) return Response.json({ error: "pass ?file=<one of /api/backup/list>" }, { status: 400, headers: head });
  if (!Number.isFinite(confirm))
    return Response.json({ error: "pass ?confirm=<the swimmer count the GET reported>" }, { status: 400, headers: head });

  const p = await plan(request, file);
  if ("error" in p) return Response.json({ error: p.error }, { status: 502, headers: head });

  if (p.willBe.swimmers !== confirm)
    return Response.json(
      { error: `that backup makes ${p.willBe.swimmers} swimmers, not ${confirm}`, hint: "Ask the GET again — the roster moved since you looked." },
      { status: 409, headers: head },
    );
  // A backup that would leave the club with almost nobody is a broken file, not a decision.
  if (p.willBe.swimmers < 50)
    return Response.json(
      { error: `that backup makes only ${p.willBe.swimmers} swimmers, which is not a roster this club has ever had` },
      { status: 409, headers: head },
    );

  // Today's overlay, kept before it is replaced. This is what makes the whole thing reversible:
  // run the same call against this file to come back.
  const undoName = `before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const keep = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${undoName}`, {
    method: "POST",
    headers: { ...svc(), "content-type": "application/json" },
    body: JSON.stringify({ takenAt: new Date().toISOString(), club_state: { vx_roster_edits: p.live } }),
  });
  if (!keep.ok)
    return Response.json(
      { error: "could not keep a copy of today's roster first, so nothing was changed", status: keep.status },
      { status: 502, headers: head },
    );

  const put = await fetch(SB_URL + "/rest/v1/club_state", {
    method: "POST",
    headers: { ...svc(), "content-type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ key: "vx_roster_edits", value: p.from, updated_at: new Date().toISOString() }]),
  });
  if (!put.ok)
    return Response.json(
      { error: "the database refused the write", status: put.status, undo: undoName },
      { status: 502, headers: head },
    );

  return Response.json(
    {
      restored: p.file,
      swimmers: p.willBe.swimmers,
      dates: p.willBe.dates,
      was: p.isNow,
      undo: `POST /api/backup/restore-roster?file=${encodeURIComponent(undoName)}&confirm=${p.isNow.swimmers}`,
      next: "Reopen the app. Every device picks it up on its next sync.",
    },
    { headers: head },
  );
}

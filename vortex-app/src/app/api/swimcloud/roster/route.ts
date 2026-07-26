// Best-effort SwimCloud team roster fetch. SwimCloud has NO official public API, so this
// server-side route fetches the PUBLIC team roster page and parses the swimmer links.
// Caveats: SwimCloud may block automated requests (Cloudflare), the page structure can change,
// and this can only see PUBLIC data — never your logged-in/coach-private data.
//
// Usage:  /api/swimcloud/roster?team=10045677
//
// The reliable path for TIMES is still: export from SwimCloud -> import via the app's Hy-Tek
// importer. This route is a convenience for pulling the roster names.

export async function GET(request: Request) {
  const url = new URL(request.url);
  const team = (url.searchParams.get("team") || "").replace(/[^0-9]/g, "");
  if (!team) return Response.json({ error: "missing ?team=<id>" }, { status: 400 });

  const target = `https://www.swimcloud.com/team/${team}/roster/`;
  let html = "";
  try {
    const r = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; VortexSC/1.0; +https://vortexswimmingclub.com)",
        Accept: "text/html,application/xhtml+xml",
      },
      // don't cache aggressively; SwimCloud roster changes
      cache: "no-store",
    });
    if (!r.ok) {
      return Response.json({ error: `SwimCloud returned HTTP ${r.status} (it may be blocking automated requests)`, team }, { status: 502 });
    }
    html = await r.text();
  } catch {
    return Response.json({ error: "could not reach SwimCloud", team }, { status: 502 });
  }

  // Parse anchors like  <a href="/swimmer/1234567/">Firstname Lastname</a>
  const seen = new Set<string>();
  const swimmers: Array<{ id: string; name: string }> = [];
  const re = /href="\/swimmer\/(\d+)\/?"[^>]*>([^<]{2,60})</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    const name = m[2].replace(/\s+/g, " ").trim();
    if (!name || /^\d+$/.test(name) || seen.has(id)) continue;
    seen.add(id);
    swimmers.push({ id, name });
  }

  return Response.json({
    team,
    count: swimmers.length,
    swimmers,
    note: swimmers.length
      ? "Public roster names parsed. Times are not included — export results from SwimCloud and use the app's Hy-Tek import for those."
      : "No swimmers parsed — SwimCloud may have blocked the request or changed its page. Use the Hy-Tek export/import path instead.",
  });
}

// Which build this deployment is actually serving.
//
// The app is installed to the home screen, and on iOS a home-screen app suspends and resumes
// without ever reloading — so a coach can be looking at a build from hours ago with no way to
// know. That has now cost several rounds of debugging a fix that was live the whole time, on a
// screen that had already been replaced.
//
// The build stamp lives in proto.html, which is the thing that goes stale, so it is read from
// there rather than kept in a second place that could disagree with it.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

let cached: { build: string; at: number } | null = null;

function stampIn(src: string): string {
  return (src.match(/const VX_BUILD='([^']+)'/) || [])[1] || "";
}

export async function GET(request: Request) {
  // The file does not change within a deployment, so re-reading it per request is waste — but
  // holding it for ever would defeat the point on a long-lived instance.
  if (cached && Date.now() - cached.at < 30_000)
    return Response.json({ build: cached.build }, { headers: { "cache-control": "no-store" } });

  // Fetched from this deployment, not read off the disk. `public/` is served by the CDN and is
  // not in the serverless bundle, so the disk read only ever worked on a laptop: in production
  // this answered "" every time, the app read that as "no news", and the prompt that exists to
  // tell a coach their phone is running an old build has never once appeared. Several rounds of
  // debugging fixes that were already live were spent on exactly that.
  let build = "";
  try {
    const r = await fetch(new URL(request.url).origin + "/proto.html", { cache: "no-store" });
    if (r.ok) build = stampIn(await r.text());
  } catch {
    build = "";
  }
  if (!build) {
    try {
      build = stampIn(await readFile(join(process.cwd(), "public", "proto.html"), "utf8"));
    } catch {
      build = "";
    }
  }
  cached = { build, at: Date.now() };
  // An empty build is "cannot tell", and the app treats it as no news rather than prompting a
  // reload it cannot justify.
  return Response.json({ build }, { headers: { "cache-control": "no-store" } });
}

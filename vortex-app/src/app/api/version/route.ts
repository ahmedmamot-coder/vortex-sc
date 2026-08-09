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

export async function GET() {
  // The file does not change within a deployment, so re-reading it per request is waste — but
  // holding it for ever would defeat the point on a long-lived instance.
  if (cached && Date.now() - cached.at < 30_000)
    return Response.json({ build: cached.build }, { headers: { "cache-control": "no-store" } });

  let build = "";
  try {
    const src = await readFile(join(process.cwd(), "public", "proto.html"), "utf8");
    build = (src.match(/const VX_BUILD='([^']+)'/) || [])[1] || "";
  } catch {
    build = "";
  }
  cached = { build, at: Date.now() };
  // An empty build is "cannot tell", and the app treats it as no news rather than prompting a
  // reload it cannot justify.
  return Response.json({ build }, { headers: { "cache-control": "no-store" } });
}

// The coaching assistants, for real.
//
// These screens used to return a hardcoded paragraph after a 1.3-second delay dressed up as
// thinking. That is worse than having no assistant: a coach reads "rest on the 8×100 may be too
// generous" as a comment on the set they just wrote, when it was written months ago by someone
// who had never seen it.
//
// Two rules shape everything below, and both exist because this club's swimmers are children.
//
// 1. No child is identifiable here. The route accepts a fixed set of numbers and short enums and
//    nothing else — no names, no dates of birth, no swimmer ids, no free text about a person.
//    Anything else in the request is dropped before the prompt is built, so a later change to
//    the app cannot start leaking names by accident. Age matters for training advice and is kept
//    as a number; on its own it identifies nobody.
// 2. The model advises the coach; it does not prescribe to the child. The system prompt refuses
//    calorie targets, weight targets, supplements and anything medical for under-18s, and says
//    to defer to a qualified professional instead. A confident paragraph about a 12-year-old's
//    diet is exactly the kind of thing an LLM will produce on request and nobody should ship.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { requireStaff } from "@/lib/callerAuth";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

export const maxDuration = 60;

type Block = { label: string; color: string; lines: string[] };

const COLORS = ["#067EEA", "#2733D6", "#8A22D5", "#1CB87A", "#F5A623"];

const SYSTEM = `You are assisting a swimming coach at a club in Doha, Qatar. The squads are
children and teenagers.

Answer as a coach talks to another coach: specific, short, and about the swimming. Prefer a
number to an adjective — "8×100 @ 1:25" rather than "tighten the intervals a little".

You are given measurements, never a name. Do not ask who the swimmer is and do not invent one.

Hard limits, because these are minors:
- No calorie targets, no weight or body-fat targets, no diet plans, no supplements, no fasting.
  General fuelling around training (what to eat before a session, hydration in the heat) is fine.
- Nothing medical. No diagnosing pain, injury or illness. If the data suggests a problem, say
  what you noticed and that it is one for a physio or doctor, and stop there.
- No maximal strength testing or heavy lifting prescriptions for pre-pubertal swimmers.
- If the data given is too thin to say anything useful, say so plainly and stop. Do not fill the
  space. Say it in a block like any other answer — "Not enough here" with a line saying what is
  missing is a useful answer; an empty response is not.

Give 2 to 4 blocks, each 1 to 4 lines. A label is one or two words. A line is one sentence.`;

// The shape is enforced by the API, not asked for in the prompt.
//
// This used to end with "Return ONLY a JSON object, no prose and no code fence", and the answer
// was pulled back out with a regex. That is the whole of why the video screen kept saying "the
// assistant did not return anything usable": the model has to comply with an instruction about
// formatting at the same time as one that says to speak plainly when the data is thin, and when
// it chose plainly there was no JSON to find. Nothing was wrong with the request, the key, or the
// swimmer's splits — the answer simply arrived in prose and was dropped on the floor.
//
// Structured outputs make it the API's job. The model cannot return a shape that does not fit.
const ANSWER = z.object({
  title: z.string(),
  blocks: z.array(z.object({
    label: z.string(),
    lines: z.array(z.string()),
  })),
});

const TASKS: Record<string, string> = {
  review: `Review this training set. Three blocks: what it is (the balance of the session as
written, with the rough proportions), what to watch (the one or two things most likely to stop it
doing what it is for), and a sharper version (concrete changes — intervals, distances, rest).`,
  swimmer: `Given this swimmer's numbers, say what to work on next. Blocks: where they are
strongest, the clearest gap, and what to do in training about it over the next few weeks. If
attendance or load looks like the real story, say that instead.`,
  season: `Draft a season plan for this squad. Blocks by phase, with weeks, emphasis and volume.`,
  dryland: `Draft a dryland session appropriate to the ages given. Blocks: activation, main work,
core and mobility. Bodyweight and technique first.`,
  nutrition: `Practical fuelling around training sessions in Doha's heat, for this age group.
General guidance for a coach to pass on — no targets, no plans for individuals.`,
  race: `Read this race, split by split, and say what to work on. Each split carries the distance
it ends at, the time it took, the speed, and — where the coach counted them — the strokes taken,
the dolphin kicks off that wall, the stroke rate, the distance per stroke and the stroke index.
Blocks: where the race was won or lost (the first 15, the speed drop, stroke rate against
distance per stroke, the underwater kicks), the one thing to change first, and what to set in
training for it. Refer to a split by its distance — "the 35", "the last 5". Say only what these
numbers support: a swim with no stroke counts cannot be given a verdict on the stroke.`,
};

// Only these reach the prompt. Everything else in the request is dropped.
const NUM = ["age", "ageMin", "ageMax", "swimmers", "attendancePct", "sessionsPerWeek",
  "acuteLoad", "chronicLoad", "acuteChronic", "wellness", "sleepHours", "restingHr", "hrv",
  "weightKg", "musclePct", "bodyFatPct", "weeksToMeet", "poolLength"];
const STR = ["squadLevel", "course", "primaryStroke", "sex"];
const ENUM_SEX = ["male", "female", ""];

// A best time, as numbers and an event name — no meet, no date, nothing that places a child.
type Best = { event?: unknown; seconds?: unknown; dropSeconds?: unknown };

// A race, as arithmetic. Every field here is a measurement the video screen worked out from the
// split times and the counts a coach tapped in: how far, how long, how fast, how many strokes,
// how many dolphin kicks. The mark's own label never comes — a coach types "Sara lane 4" on a
// lane, and a label is the one field in this payload where a child's name could ride along. The
// distance says which mark it is just as well.
const RACE_NUM: [string, number][] = [
  ["distance", 1500], ["total", 3600], ["first15", 60], ["dropPct", 100],
  ["kicksTotal", 400], ["lengths", 40],
];
const SPLIT_NUM: [string, number][] = [
  ["vel", 10], ["strokes", 200], ["kicks", 120], ["sr", 240], ["dps", 12], ["si", 60],
];
type Split = { metres?: unknown; sec?: unknown } & Record<string, unknown>;

function bounded(v: unknown, max: number): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return Math.round(n * 100) / 100;
}

// Exported for the same reason as cleanContext: the tests must exercise the filter that ships.
export function cleanRace(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;
  const splits = (Array.isArray(src.splits) ? src.splits : []).slice(0, 48)
    .map((s) => {
      const r = (s || {}) as Split;
      const metres = bounded(r.metres, 2000), sec = bounded(r.sec, 3600);
      if (metres == null || sec == null || sec <= 0) return null;
      const out: Record<string, number> = { metres, sec };
      for (const [k, max] of SPLIT_NUM) {
        const n = bounded(r[k], max);
        if (n != null && n > 0) out[k] = n;
      }
      return out;
    })
    .filter(Boolean);
  if (!splits.length) return null;
  const race: Record<string, unknown> = { splits };
  for (const [k, max] of RACE_NUM) {
    const n = bounded(src[k], max);
    if (n != null) race[k] = n;
  }
  return race;
}

// Exported so the tests exercise the real filter rather than a copy of it. What this drops is
// the whole safeguard; a test against a reimplementation of it would agree with itself for ever.
export function cleanContext(raw: unknown): Record<string, unknown> {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of NUM) {
    const n = typeof src[k] === "number" ? src[k] : parseFloat(String(src[k] ?? ""));
    if (Number.isFinite(n)) out[k] = Math.round((n as number) * 100) / 100;
  }
  for (const k of STR) {
    const v = String(src[k] ?? "").trim().slice(0, 40);
    // Free text is where a name would arrive. These are short labels; anything longer is dropped.
    if (v && /^[\w \-/+.]{1,40}$/.test(v)) out[k] = v;
  }
  if (typeof out.sex === "string" && !ENUM_SEX.includes(String(out.sex).toLowerCase())) delete out.sex;
  const bests = Array.isArray(src.bests) ? (src.bests as Best[]).slice(0, 24) : [];
  const cleanBests = bests.map((b) => {
    const event = String(b?.event ?? "").trim().slice(0, 24);
    const seconds = typeof b?.seconds === "number" ? b.seconds : parseFloat(String(b?.seconds ?? ""));
    const drop = typeof b?.dropSeconds === "number" ? b.dropSeconds : parseFloat(String(b?.dropSeconds ?? ""));
    if (!/^\d{2,4} ?[A-Za-z]{2,8}$/.test(event) || !Number.isFinite(seconds)) return null;
    return Number.isFinite(drop) ? { event, seconds, dropSeconds: drop } : { event, seconds };
  }).filter(Boolean);
  if (cleanBests.length) out.bests = cleanBests;
  const race = cleanRace(src.race);
  if (race) out.race = race;
  return out;
}

function apiKey() {
  return (process.env.ANTHROPIC_API_KEY || "").trim()
    .replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").replace(/\s+/g, "");
}

function scrub(text: string) {
  return (text || "").replace(/sk-ant-[A-Za-z0-9_\-\s]{8,}/g, "[the key]");
}

export async function POST(request: Request) {
  // Signed-in coaches only. The route had no gate at all, and behind it is the club's Anthropic
  // key: anybody who found the URL could spend it, at this club's expense, for as long as it took
  // somebody to notice the bill. Nothing here is useful to a person who is not coaching.
  const who = await requireStaff(request);
  if (!who.ok) return who.response;

  const key = apiKey();
  if (!key) return Response.json({ error: "The AI reader is not set up on this deployment yet." }, { status: 503 });

  let body: { task?: string; text?: string; context?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "bad request" }, { status: 400 }); }

  const task = String(body.task || "");
  if (!TASKS[task]) return Response.json({ error: "unknown task" }, { status: 400 });

  // The coach's own words — a training set, or what they want. Not about a person, and capped
  // so a whole roster cannot be pasted in.
  const text = String(body.text || "").slice(0, 6000);
  const context = cleanContext(body.context);
  if (task === "review" && !text.trim())
    return Response.json({ error: "Paste the set you want reviewed first." }, { status: 400 });

  const user = [TASKS[task],
    Object.keys(context).length ? "\nNumbers:\n" + JSON.stringify(context) : "",
    text.trim() ? "\nFrom the coach:\n" + text.trim() : ""].join("\n");

  // A short, structured answer from a model that is allowed to think about it.
  //
  // Three things here were quietly wrong before. The model was Sonnet where this club is paying
  // for the better one; max_tokens was 1200, which a race with a dozen splits can run past — and
  // a truncated answer is an unparseable one, which arrived on screen as "did not return anything
  // usable"; and the failure said the same sentence whatever had happened, so there was no way to
  // tell a cut-off answer from a refusal from a model that had simply written prose.
  const client = new Anthropic({ apiKey: key, timeout: 50_000, maxRetries: 1 });

  let response;
  try {
    response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
      output_config: { format: zodOutputFormat(ANSWER), effort: "medium" },
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError)
      return Response.json({ error: "The AI reader's key was refused. It needs replacing in the deployment settings." }, { status: 502 });
    if (e instanceof Anthropic.RateLimitError)
      return Response.json({ error: "The assistant is rate limited right now. Try again in a minute." }, { status: 429 });
    if (e instanceof Anthropic.APIConnectionTimeoutError)
      return Response.json({ error: "The assistant did not answer in time." }, { status: 504 });
    if (e instanceof Anthropic.APIError)
      return Response.json({ error: "The assistant refused the request.", said: scrub(e.message).slice(0, 200), status: e.status }, { status: 502 });
    return Response.json({ error: "Could not reach the assistant." }, { status: 502 });
  }

  // Say which thing went wrong, because "did not return anything usable" covered four different
  // faults and sent this club looking at their API key for a race that was simply too long.
  if (response.stop_reason === "refusal") {
    const why = response.stop_details?.explanation || response.stop_details?.category || "";
    return Response.json({ error: "The assistant declined to answer this one.", said: scrub(String(why)).slice(0, 200) }, { status: 502 });
  }
  if (response.stop_reason === "max_tokens")
    return Response.json({ error: "The answer was cut off before it finished. Try a shorter set, or fewer splits." }, { status: 502 });

  const parsed = response.parsed_output;
  if (!parsed || !Array.isArray(parsed.blocks) || !parsed.blocks.length) {
    // Keep the model's own words when the shape did not validate. Somebody has to be able to see
    // what actually came back, or the next round of this is guesswork again.
    const said = response.content.filter((c) => c.type === "text").map((c) => c.text).join("").trim();
    return Response.json({ error: "The assistant answered, but not in a shape this screen can draw.", said: scrub(said).slice(0, 200) }, { status: 502 });
  }

  // Shaped here rather than trusted. The colours are ours, and the lengths are ours.
  const blocks: Block[] = parsed.blocks.slice(0, 4).map((b, i) => ({
    label: String(b.label ?? "").trim().slice(0, 24) || "Notes",
    color: COLORS[i % COLORS.length],
    lines: (Array.isArray(b.lines) ? b.lines : []).map((l) => String(l).trim().slice(0, 300)).filter(Boolean).slice(0, 4),
  })).filter((b) => b.lines.length);

  if (!blocks.length)
    return Response.json({ error: "The assistant answered with nothing in it. Try again." }, { status: 502 });

  return Response.json({ title: String(parsed.title ?? "").trim().slice(0, 90) || "Coach's notes", blocks });
}

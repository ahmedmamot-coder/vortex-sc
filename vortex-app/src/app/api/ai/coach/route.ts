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
- If the data given is too thin to say anything useful, say so plainly. Do not fill the space.

Return ONLY a JSON object, no prose and no code fence:
{"title": "...", "blocks": [{"label": "...", "lines": ["...", "..."]}]}
2 to 4 blocks, each 1 to 4 lines. A label is one or two words. A line is one sentence.`;

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
};

// Only these reach the prompt. Everything else in the request is dropped.
const NUM = ["age", "ageMin", "ageMax", "swimmers", "attendancePct", "sessionsPerWeek",
  "acuteLoad", "chronicLoad", "acuteChronic", "wellness", "sleepHours", "restingHr", "hrv",
  "weightKg", "musclePct", "bodyFatPct", "weeksToMeet", "poolLength"];
const STR = ["squadLevel", "course", "primaryStroke", "sex"];
const ENUM_SEX = ["male", "female", ""];

// A best time, as numbers and an event name — no meet, no date, nothing that places a child.
type Best = { event?: unknown; seconds?: unknown; dropSeconds?: unknown };

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

  let r: Response;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(40_000),
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1200,
        system: SYSTEM,
        messages: [{ role: "user", content: user }],
      }),
    });
  } catch (e) {
    const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
    return Response.json({ error: timedOut ? "The assistant did not answer in time." : "Could not reach the assistant." }, { status: 504 });
  }

  if (!r.ok) {
    const raw = await r.text().catch(() => "");
    let said = ""; try { said = (JSON.parse(raw) as { error?: { message?: string } })?.error?.message || ""; } catch { said = ""; }
    return Response.json({ error: "The assistant refused the request.", said: scrub(said || raw).slice(0, 200), status: r.status }, { status: 502 });
  }

  const j = (await r.json().catch(() => null)) as { content?: Array<{ type?: string; text?: string }> } | null;
  const out = (j?.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("").trim();

  let parsed: { title?: unknown; blocks?: unknown } = {};
  try { const m = out.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch { parsed = {}; }

  // Shape it here rather than trusting it. A malformed answer must not reach the screen as a
  // half-rendered panel, and colours are ours, not the model's.
  const blocks: Block[] = (Array.isArray(parsed.blocks) ? parsed.blocks : [])
    .slice(0, 4)
    .map((b, i) => {
      const raw = (b || {}) as { label?: unknown; lines?: unknown };
      const lines = (Array.isArray(raw.lines) ? raw.lines : [])
        .map((l) => String(l).trim().slice(0, 300)).filter(Boolean).slice(0, 4);
      return { label: String(raw.label ?? "").trim().slice(0, 24) || "Notes", color: COLORS[i % COLORS.length], lines };
    })
    .filter((b) => b.lines.length);

  if (!blocks.length) return Response.json({ error: "The assistant did not return anything usable. Try again." }, { status: 502 });

  return Response.json({ title: String(parsed.title ?? "").trim().slice(0, 90) || "Coach's notes", blocks });
}

// The coaching assistant, as a conversation.
//
// /api/ai/coach answers one shaped question and returns blocks. This is the other half a coach
// actually wants: "his 100 free has not moved in six weeks, what would you change", then a
// follow-up, then another — with the numbers already on the table.
//
// It inherits both rules from the single-shot route, because they are the reason that route is
// safe to have at all:
//
//  1. NO CHILD IS IDENTIFIABLE HERE. The context is run through the same cleanContext() the other
//     route uses — a fixed set of numbers and short enums, everything else dropped before the
//     prompt is built. What is new in a conversation is that the coach types freely, and a name
//     can arrive that way. So the coach's own words are scrubbed too, and the system prompt tells
//     the model to answer about the swimming rather than repeat a name back.
//
//  2. THE MODEL ADVISES THE COACH; IT DOES NOT PRESCRIBE TO THE CHILD. Same hard limits: no
//     calorie or weight targets, nothing medical, no maximal lifting for pre-pubertal swimmers.
//
// Staff only, like every other route that spends the club's Anthropic key.

import Anthropic from "@anthropic-ai/sdk";
import { requireStaff } from "@/lib/callerAuth";
import { cleanContext } from "../coach/route";

export const maxDuration = 60;

const SYSTEM = `You are assisting a swimming coach at a club in Doha, Qatar. The squads are
children and teenagers, and you are talking to their coach.

Answer as a coach talks to another coach: specific, short, and about the swimming. Prefer a
number to an adjective — "8×100 @ 1:25" rather than "tighten the intervals a little". Two or
three short paragraphs at most. No headings, no bullet-point essays.

You are given measurements, never a name. If the coach types a name, do not repeat it back and
do not ask who the swimmer is — answer about the swimming. Say "this swimmer".

Hard limits, because these are minors:
- No calorie targets, no weight or body-fat targets, no diet plans, no supplements, no fasting.
  General fuelling around training (what to eat before a session, hydration in the heat) is fine.
- Nothing medical. No diagnosing pain, injury or illness. If something in the data suggests a
  problem, say what you noticed and that it is one for a physio or doctor, and stop there.
- No maximal strength testing or heavy lifting prescriptions for pre-pubertal swimmers.
- Nothing you say is for the swimmer to read as an instruction. It is for the coach to decide on.

If what you have been given is too thin to say anything useful, say so plainly and say what would
help. Do not fill the space.`;

/** The coach's own words, with the things that identify a child taken out. */
function scrub(text: string): string {
  return String(text || "")
    .slice(0, 2000)
    // Dates of birth in any of the shapes the club writes them.
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, "[date]")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "[date]")
    // Anything that reaches a person directly.
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/gi, "[email]")
    .replace(/\+?\d[\d\s-]{7,}\d/g, "[phone]")
    .trim();
}

function apiKey(): string {
  // Same cleaning as the other route: a key pasted from a phone arrives with the line wrapping
  // still in it, and trim() only takes the ends.
  return String(process.env.ANTHROPIC_API_KEY || "").replace(/\s+/g, "");
}

type Turn = { role: "user" | "assistant"; content: string };

export async function POST(request: Request) {
  const who = await requireStaff(request);
  if (!who.ok) return who.response;

  const key = apiKey();
  if (!key) return Response.json({ error: "The assistant is not set up on this deployment yet." }, { status: 503 });

  let body: { messages?: unknown; context?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "bad request" }, { status: 400 }); }

  const raw = Array.isArray(body.messages) ? body.messages : [];
  // The last 12 turns. A conversation longer than that is a new question, and an unbounded
  // history is an unbounded bill.
  const history: Turn[] = raw
    .slice(-12)
    .map((m) => {
      const r = (m as Turn)?.role === "assistant" ? "assistant" : "user";
      return { role: r as Turn["role"], content: scrub(String((m as Turn)?.content ?? "")) };
    })
    .filter((m) => m.content.length > 0);

  if (!history.length) return Response.json({ error: "Ask something first." }, { status: 400 });
  if (history[history.length - 1].role !== "user") {
    return Response.json({ error: "The last message must be the coach's." }, { status: 400 });
  }

  const context = cleanContext(body.context);
  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));

  // The numbers go in as an operator turn rather than glued onto the coach's sentence, so the
  // model can tell what the coach said from what the app measured.
  if (Object.keys(context).length) {
    messages.splice(messages.length - 1, 0, {
      role: "assistant",
      content: "Numbers on file for this swimmer:\n" + JSON.stringify(context),
    });
  }

  const client = new Anthropic({ apiKey: key, timeout: 50_000, maxRetries: 1 });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 4000,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      messages,
    });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    if (err?.status === 429) return Response.json({ error: "The assistant is busy — try again in a moment." }, { status: 429 });
    return Response.json({ error: "The assistant could not be reached: " + (err?.message || "unknown error") }, { status: 502 });
  }

  // A safety classifier may decline, which arrives as a 200 with stop_reason "refusal" — not as
  // an error. Checking content first would read an empty array and report "nothing usable".
  if (response.stop_reason === "refusal") {
    return Response.json({
      error: "The assistant declined to answer that one. Rephrase it as a question about the training.",
    }, { status: 200 });
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!text) return Response.json({ error: "The assistant did not return anything usable. Try again." }, { status: 200 });

  return Response.json({
    reply: text,
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
  });
}

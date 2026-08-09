// Read an InBody result sheet from a photograph.
//
// In-browser OCR was the wrong tool for this. Tesseract has to fetch a worker, a WASM core
// and a ~15MB language model before it can read anything, and on a phone at the poolside
// that is a long wait that can simply never finish — which is exactly what happened: the app
// sat on "reading it as a picture" and never came back.
//
// A vision model reads the sheet in one request, and reads it the way a person does: it
// knows the number after the printed axis is the measurement, and that "VFA(cm2)" is a unit
// and not a value. The key stays on the server; it is never sent to a phone.
//
// Set ANTHROPIC_API_KEY in Vercel. Without it this reports notConfigured and the app falls
// back to in-browser OCR rather than pretending.

export const maxDuration = 60;

const FIELDS = [
  "weight", "smm", "bodyFatMass", "pbf", "bmi", "bmr", "visceralFat", "whr", "protein",
  "minerals", "tbw", "icw", "ecw", "ecwRatio", "phaseAngle", "score", "smi", "ffm", "slm",
  "boneMineral", "bodyCellMass", "obesityDegree", "height", "testDate",
];

const PROMPT = `This is a photograph of an InBody body-composition result sheet.

Read the measured values off it and return ONLY a JSON object — no prose, no code fence.

Use exactly these keys, omitting any you cannot read clearly:
weight (kg), smm (skeletal muscle mass, kg), bodyFatMass (kg), pbf (percent body fat, %),
bmi, bmr (kcal), visceralFat (visceral fat area), whr (waist-hip ratio), protein (kg),
minerals (kg), tbw (total body water, L), icw (L), ecw (L), ecwRatio, phaseAngle (degrees),
score (InBody score out of 100), smi (kg/m2), ffm (fat free mass, kg), slm (soft lean mass, kg),
boneMineral (kg), bodyCellMass (kg), obesityDegree (%), height (cm),
testDate (the test date printed on the sheet, as YYYY-MM-DD).

Two things this sheet does that mislead a careless reading:
- Each row of Muscle-Fat and Obesity Analysis prints its whole axis before the value —
  "Weight (kg) 55 70 85 100 ... 205 %  55.8". The measurement is the number AFTER the axis.
- Under Weight Control there is a target weight and three control figures, often 0.0.
  Those are not the swimmer's measurements.

Every value must be a number, except testDate which is a string. If the sheet is unreadable,
return {}.`;

type Body = { image?: string; mime?: string };

// Open this in a browser to see whether the key has actually reached the running deployment:
//   https://vortexswimmingclub.com/api/inbody/read
// Adding a variable in Vercel does not change a deployment that is already live — it applies
// to the next build. If this says configured:false after you have set it, it has not been
// redeployed, or it was set for Preview rather than Production.
// Pasting a key into a settings box goes wrong in the same few ways every time: quotes come
// along with it, a trailing newline, a "Bearer " prefix, or the copy is short. None of those
// are visible by looking at the box, so they are cleaned off here and reported below.
function apiKey() {
  return (process.env.ANTHROPIC_API_KEY || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^Bearer\s+/i, "")
    // Whitespace *inside* the key, not just around it. Copying a hundred-character key out of
    // a notes app on a phone brings the line wrapping with it, so the value arrives with spaces
    // or newlines in the middle. trim() removes neither, the settings box shows nothing amiss,
    // and the key then fails at the last possible moment — when a header is built from it — with
    // an error about header values that reads like a bug in the app. A key never legitimately
    // contains a space, so there is nothing to lose by removing them all.
    .replace(/\s+/g, "");
}

// Nothing derived from an exception may be returned without passing through here.
//
// This is not hypothetical caution: an error message from the header builder quoted the whole
// key back, that message was handed to the browser to help with debugging, and the key was
// printed on a coach's screen and into a screenshot. Anything that can carry a key to a client
// eventually does, so the scrubbing belongs at the boundary rather than at each call site.
function scrub(text: string) {
  return (text || "").replace(/sk-ant-[A-Za-z0-9_\-\s]{8,}/g, "[the key]");
}

export async function GET() {
  const rawKey = process.env.ANTHROPIC_API_KEY || "";
  const key = apiKey();
  const notes: string[] = [];
  if (!key) notes.push("ANTHROPIC_API_KEY is not set on this deployment. Set it in Vercel for Production, then redeploy — a new variable does not reach a build that is already running.");
  else {
    // Say which, because they are fixed the same way but they fail very differently. Spaces in
    // the middle are the nasty one: the key looks perfect in the settings box and fails only
    // when a header is built from it, with an error that reads like a fault in the app.
    if (/\S\s+\S/.test(rawKey.trim())) notes.push("The stored value had spaces or line breaks inside it — copying a long key out of a notes app on a phone brings the line wrapping with it. They are being removed here, but paste it again as one unbroken line when you get the chance.");
    else if (rawKey !== key) notes.push("The stored value had quotes, spaces or a 'Bearer' prefix around it. Those are being stripped, but it is worth pasting it in clean.");
    // The example from the instructions, pasted in as though it were the key. Easily done,
    // and it fails looking exactly like a wrong key rather than a missing one.
    if (/\.\.\.|…|xxx|your[-_ ]?key/i.test(key) || key === "sk-ant-")
      notes.push("That is the example placeholder, not a key. Copy the real one from console.anthropic.com → API keys — it is about 100 characters and begins sk-ant-api03-.");
    else if (!key.startsWith("sk-ant-")) notes.push("This does not look like an Anthropic API key. It must come from console.anthropic.com → API keys and begin sk-ant-. A claude.ai login or a key from another provider will not work.");
    else if (key.length < 60) notes.push("The key looks short — a real one is about 100 characters. Check the whole thing was copied.");
  }
  // Shape only. The key itself is never returned.
  //
  // checkedAt is here to be looked at: if it does not change when you reload, you are reading
  // a cached copy and nothing else on this page can be trusted either.
  return Response.json({
    configured: !!key,
    keyPrefix: key ? key.slice(0, 11) + "..." : null,
    keyLength: key ? key.length : 0,
    checkedAt: new Date().toISOString(),
    notes: notes.length ? notes : ["ready"],
  }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const key = apiKey();
  if (!key) return Response.json({ notConfigured: true, values: {} });

  let body: Body;
  try { body = (await request.json()) as Body; } catch { return Response.json({ error: "bad request" }, { status: 400 }); }

  const image = (body.image || "").replace(/^data:[^,]+,/, "");
  const mime = body.mime || "image/jpeg";
  if (!image) return Response.json({ error: "no image" }, { status: 400 });
  // Vercel caps the request body; the app downscales before sending, so anything this large
  // is a mistake rather than a sheet.
  if (image.length > 6_000_000) return Response.json({ error: "image too large" }, { status: 413 });

  // The call out to the reader must be given less time than this function is allowed to live.
  //
  // Without a deadline of its own it can hang until the platform kills the whole invocation,
  // and a killed invocation does not get to answer — the connection is simply dropped. In the
  // browser that surfaces as a failed request carrying no status and no message, which reads
  // exactly like "the phone has no signal" and sends you to check the network, the key, the
  // size of the upload: everything except the one thing that happened. Timing out here means
  // there is always a real reply saying what went wrong.
  let r: Response;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(40_000),
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mime, data: image } },
            { type: "text", text: PROMPT },
          ],
        }],
      }),
    });
  } catch (e) {
    const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
    return Response.json({
      error: timedOut
        ? "the reader did not answer in time"
        : "this deployment could not reach the reader — its own outbound connection failed",
      said: scrub((e as Error)?.message || "").slice(0, 200),
    }, { status: 504 });
  }

  if (!r.ok) {
    // Pass back what the reader actually said. "invalid x-api-key" and "credit balance is too
    // low" are different problems with the same HTTP status, and guessing between them wastes
    // somebody's evening.
    const body = await r.text().catch(() => "");
    let said = "";
    try { said = (JSON.parse(body) as { error?: { message?: string } })?.error?.message || ""; } catch { said = ""; }
    return Response.json({
      error: "reader refused the request",
      status: r.status,
      // A refusal quotes back what it was given — "invalid x-api-key: sk-ant-…" is a normal
      // shape for one — so this needs scrubbing every bit as much as an exception does.
      said: scrub(said || body).slice(0, 200),
    }, { status: 502 });
  }

  const j = (await r.json().catch(() => null)) as { content?: Array<{ type?: string; text?: string }> } | null;
  const text = (j?.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("").trim();

  // Take the JSON object out of whatever came back, and keep only the fields we asked for,
  // as numbers. A model's stray sentence must never reach a child's record as a measurement.
  let parsed: Record<string, unknown> = {};
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]) as Record<string, unknown>;
  } catch { parsed = {}; }

  const values: Record<string, number | string> = {};
  for (const k of FIELDS) {
    const v = parsed[k];
    if (v == null) continue;
    if (k === "testDate") {
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) values[k] = v;
      continue;
    }
    const n = typeof v === "number" ? v : parseFloat(String(v));
    if (Number.isFinite(n)) values[k] = n;
  }

  return Response.json({ values, read: Object.keys(values).length });
}

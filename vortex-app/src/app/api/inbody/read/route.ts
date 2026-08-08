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
export async function GET() {
  const key = process.env.ANTHROPIC_API_KEY || "";
  return Response.json({
    configured: !!key,
    keyLooksRight: key ? key.startsWith("sk-ant-") : null,
    hint: key ? "ready" : "Set ANTHROPIC_API_KEY in Vercel (Production) and redeploy — a new variable does not reach a deployment that is already running.",
  });
}

export async function POST(request: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ notConfigured: true, values: {} });

  let body: Body;
  try { body = (await request.json()) as Body; } catch { return Response.json({ error: "bad request" }, { status: 400 }); }

  const image = (body.image || "").replace(/^data:[^,]+,/, "");
  const mime = body.mime || "image/jpeg";
  if (!image) return Response.json({ error: "no image" }, { status: 400 });
  // Vercel caps the request body; the app downscales before sending, so anything this large
  // is a mistake rather than a sheet.
  if (image.length > 6_000_000) return Response.json({ error: "image too large" }, { status: 413 });

  let r: Response;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
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
  } catch {
    return Response.json({ error: "could not reach the reader" }, { status: 502 });
  }

  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    return Response.json({ error: "reader refused the request", status: r.status, detail: detail.slice(0, 300) }, { status: 502 });
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

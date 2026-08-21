// Vortex SC as a connector, so the club can be asked about in plain language from Claude.
//
// Speaks MCP over HTTP: a JSON-RPC POST with initialize / tools/list / tools/call. Paste the URL
// and the token into claude.ai → Settings → Connectors → Add custom connector, and "which
// Advanced A swimmers missed more than two sessions this month" becomes a question with an answer.
//
// THREE RULES, and they are the whole design:
//
//  1. READ ONLY. There is no tool here that writes, and no code path that could. A connector that
//     can change the club is a connector that can be talked into changing the club.
//
//  2. WHAT IT CAN SEE IS AN ALLOWLIST, not a filter — see src/lib/mcpData.ts. Documents, dates of
//     birth, parents' contact details, private messages, body-composition and wellness entries are
//     not reachable from here at all. These are children, and a chat window is not where any of
//     that belongs.
//
//  3. IT IS GUARDED BY A SECRET THAT MUST BE SET. No VX_MCP_TOKEN configured means the route
//     refuses every request rather than answering openly — the same lesson as BACKUP_SECRET,
//     where "if a secret is set, check it" meant "if nobody set one, let everyone in".

import {
  squads, findSwimmers, swimmerRecord, attendance, invoices, nameOf,
} from "@/lib/mcpData";

export const maxDuration = 30;

const TOKEN = process.env.VX_MCP_TOKEN || "";

type Json = Record<string, unknown>;
type RpcId = string | number | null;

function result(id: RpcId, value: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result: value });
}
function rpcError(id: RpcId, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}
/** MCP tool results are content blocks; JSON goes back as pretty text the model can read. */
function textResult(id: RpcId, value: unknown) {
  return result(id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
}

function authorised(request: Request): boolean {
  if (!TOKEN) return false;                        // unset means closed, never open
  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return given.length === TOKEN.length && given === TOKEN;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

const TOOLS = [
  {
    name: "club_overview",
    description:
      "The club at a glance: every squad with its coach, age range and how many swimmers are in it.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "find_swimmer",
    description:
      "Find swimmers by name (partial is fine). Returns id, squad, age and gender — never a date of birth, contact details or documents.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "All or part of a swimmer's name" } },
      required: ["name"], additionalProperties: false,
    },
  },
  {
    name: "swimmer_progress",
    description:
      "One swimmer's personal bests and recorded race results, plus their attendance rate over a recent window. Use find_swimmer first to get the id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Swimmer id from find_swimmer" },
        days: { type: "number", description: "Attendance window in days (default 30)" },
      },
      required: ["id"], additionalProperties: false,
    },
  },
  {
    name: "attendance_summary",
    description:
      "Attendance over a date range: the rate per squad, how many sessions were taken, and the swimmers who attended least. Answers 'who is missing training'.",
    inputSchema: {
      type: "object",
      properties: {
        squad: { type: "string", description: "Squad slug, e.g. 'adva'. Omit for the whole club." },
        from: { type: "string", description: "Start day, yyyy-mm-dd (default: 30 days ago)" },
        to: { type: "string", description: "End day, yyyy-mm-dd (default: today)" },
        below: { type: "number", description: "Only list swimmers under this attendance percentage (default 80)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "fees_summary",
    description:
      "Invoices for a month: totals issued and outstanding, per squad, and who is unpaid. Money and status only — no payment details.",
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", description: "Month as YYYY-MM (default: the most recent month with invoices)" },
      },
      additionalProperties: false,
    },
  },
];

async function callTool(name: string, args: Json): Promise<unknown> {
  switch (name) {
    case "club_overview": {
      const sq = squads();
      return { squads: sq, swimmers: sq.reduce((n, s) => n + s.swimmers, 0) };
    }

    case "find_swimmer": {
      const hits = findSwimmers(String(args.name || ""));
      return hits.length ? { matches: hits } : { matches: [], note: "No swimmer by that name." };
    }

    case "swimmer_progress": {
      const rec = swimmerRecord(String(args.id || ""));
      if (!rec) return { error: "No swimmer with that id. Use find_swimmer first." };
      const days = Number(args.days) > 0 ? Number(args.days) : 30;
      const marks = await attendance(daysAgo(days), today(), rec.swimmer.squad);
      let att: unknown = "attendance is unavailable (the database could not be reached)";
      if (marks) {
        const bare = rec.swimmer.id.split("::").pop();
        const mine = marks.filter((m) => (m.sw_id || "").split("::").pop() === bare);
        const present = mine.filter((m) => m.status === "present" || m.status === "late").length;
        att = mine.length
          ? { sessions: mine.length, attended: present, rate: Math.round((present / mine.length) * 100) + "%", windowDays: days }
          : { sessions: 0, note: `no register taken for this swimmer in the last ${days} days` };
      }
      return { swimmer: rec.swimmer, attendance: att, personalBests: rec.pbs, results: rec.results };
    }

    case "attendance_summary": {
      const from = String(args.from || daysAgo(30));
      const to = String(args.to || today());
      const squad = args.squad ? String(args.squad) : undefined;
      const below = Number(args.below) > 0 ? Number(args.below) : 80;

      const marks = await attendance(from, to, squad);
      if (!marks) return { error: "The database could not be reached." };
      if (!marks.length) return { from, to, squad: squad || "all", note: "No registers were taken in that range." };

      const bySquad: Record<string, { present: number; total: number; days: Set<string> }> = {};
      const bySwimmer: Record<string, { present: number; total: number; squad: string }> = {};
      for (const m of marks) {
        const ok = m.status === "present" || m.status === "late";
        const sq = (bySquad[m.squad_id] ||= { present: 0, total: 0, days: new Set() });
        sq.total++; if (ok) sq.present++; sq.days.add(m.day);
        const sw = (bySwimmer[m.sw_id] ||= { present: 0, total: 0, squad: m.squad_id });
        sw.total++; if (ok) sw.present++;
      }

      const squadRows = Object.entries(bySquad).map(([slug, v]) => ({
        squad: slug, sessions: v.days.size, marks: v.total,
        rate: Math.round((v.present / v.total) * 100) + "%",
      })).sort((a, b) => parseInt(a.rate) - parseInt(b.rate));

      const concern = Object.entries(bySwimmer)
        .map(([id, v]) => ({ name: nameOf(id), squad: v.squad, sessions: v.total,
                             attended: v.present, rate: Math.round((v.present / v.total) * 100) }))
        .filter((r) => r.sessions >= 3 && r.rate < below)
        .sort((a, b) => a.rate - b.rate)
        .map((r) => ({ ...r, rate: r.rate + "%" }));

      return { from, to, squad: squad || "all", bySquad: squadRows,
               below: below + "%", swimmersBelowThreshold: concern };
    }

    case "fees_summary": {
      const all = await invoices(args.period ? String(args.period) : undefined);
      if (!all) return { error: "The database could not be reached." };
      if (!all.length) return { note: "No invoices found for that period." };

      const period = args.period ? String(args.period) : all[0].period;
      const rows = all.filter((i) => i.period === period);
      const money = (n: number) => Math.round(n * 100) / 100;
      const unpaid = rows.filter((i) => i.status !== "paid");

      const bySquad: Record<string, { issued: number; outstanding: number; count: number; unpaid: number }> = {};
      for (const i of rows) {
        const s = (bySquad[i.sq_id || "unassigned"] ||= { issued: 0, outstanding: 0, count: 0, unpaid: 0 });
        s.issued += Number(i.total) || 0; s.count++;
        if (i.status !== "paid") { s.outstanding += Number(i.total) || 0; s.unpaid++; }
      }

      return {
        period,
        invoices: rows.length,
        issuedTotal: money(rows.reduce((n, i) => n + (Number(i.total) || 0), 0)),
        outstandingTotal: money(unpaid.reduce((n, i) => n + (Number(i.total) || 0), 0)),
        bySquad: Object.entries(bySquad).map(([squad, v]) => ({
          squad, invoices: v.count, unpaid: v.unpaid,
          issued: money(v.issued), outstanding: money(v.outstanding),
        })),
        unpaidSwimmers: unpaid
          .sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0))
          .slice(0, 60)
          .map((i) => ({ name: nameOf(i.sw_id), squad: i.sq_id, amount: money(Number(i.total) || 0), due: i.due, status: i.status })),
      };
    }

    default:
      return { error: `No tool called ${name}.` };
  }
}

export async function POST(request: Request) {
  let body: { jsonrpc?: string; id?: RpcId; method?: string; params?: Json };
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, "That was not valid JSON.");
  }
  const id: RpcId = body.id ?? null;
  const method = String(body.method || "");

  // A notification (no id) gets no body back, per JSON-RPC. initialized arrives this way.
  const isNotification = body.id === undefined || body.id === null;

  if (!TOKEN) {
    return rpcError(id, -32001,
      "This connector is not configured: VX_MCP_TOKEN is not set on the server.");
  }
  if (!authorised(request)) {
    if (isNotification) return new Response(null, { status: 202 });
    return rpcError(id, -32001, "Unauthorized — check the connector's token.");
  }

  switch (method) {
    case "initialize":
      return result(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "vortex-sc", version: "1.0.0" },
        instructions:
          "The members' data for Vortex Swimming Club, Doha. Read-only, and deliberately narrow: " +
          "squads, attendance, race results and fees. Swimmers are children, so documents, dates of " +
          "birth, parents' contact details, private messages and body-composition data are not " +
          "available through this connector at all — do not suggest they can be fetched. " +
          "Use find_swimmer to turn a name into an id before calling swimmer_progress.",
      });

    case "notifications/initialized":
      return new Response(null, { status: 202 });

    case "ping":
      return result(id, {});

    case "tools/list":
      return result(id, { tools: TOOLS });

    case "tools/call": {
      const params = (body.params || {}) as { name?: string; arguments?: Json };
      const name = String(params.name || "");
      if (!TOOLS.some((t) => t.name === name)) return rpcError(id, -32602, `No tool called ${name}.`);
      try {
        return textResult(id, await callTool(name, params.arguments || {}));
      } catch (e) {
        // A thrown tool is reported as a tool result, not a transport error, so the model can
        // say what went wrong instead of the connection simply looking broken.
        return result(id, {
          isError: true,
          content: [{ type: "text", text: `That failed: ${(e as Error)?.message || "unknown error"}` }],
        });
      }
    }

    default:
      return rpcError(id, -32601, `This connector does not implement ${method}.`);
  }
}

/** A GET is a person or a health check, not the protocol — say what this is rather than 405. */
export async function GET() {
  return Response.json({
    name: "vortex-sc",
    transport: "mcp over http (POST JSON-RPC)",
    configured: !!TOKEN,
    tools: TOOLS.map((t) => t.name),
    readOnly: true,
  });
}

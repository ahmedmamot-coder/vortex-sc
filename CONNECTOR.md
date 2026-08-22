# Vortex SC as a Claude connector

Ask about the club in plain language from claude.ai — *"which Advanced A swimmers missed more
than two sessions this month?"*, *"how much is outstanding for July?"*, *"has Alia's 50 free
improved?"* — and get an answer read live from the club's own data.

## Set it up

**1. Pick a token and put it in Vercel.**

```bash
openssl rand -hex 32
```

Vercel → the project → Settings → Environment Variables → add **`VX_MCP_TOKEN`** with that
value, scoped to **Production**. Redeploy.

Until it is set the connector answers every request with *"this connector is not configured"*.
That is deliberate: an unset secret means closed, not open.

**2. Add it in Claude.**

claude.ai → Settings → **Connectors** → **Add custom connector**

| Field | Value |
|---|---|
| Name | `Vortex SC` |
| Remote MCP server URL | `https://www.vortexswimmingclub.com/api/mcp/s/PASTE-THE-TOKEN-HERE` |
| OAuth Client ID | leave empty |
| OAuth Client Secret | leave empty |

So with a token of `a1b2c3…`, the URL is `https://www.vortexswimmingclub.com/api/mcp/s/a1b2c3…`.
Two things that will otherwise cost you an afternoon: paste the **actual token**, not the
placeholder, and keep the **`www.`** — the bare domain answers with a redirect to it, and the
connector should not be attached to a hop.

**The URL is the credential.** That dialog has three fields and none of them sets a request
header, which is why the token rides in the path — the connector was written around an
`Authorization: Bearer` header and, until the path route existed, could not be attached to Claude
at all. The cost of moving it is real and worth knowing: **a path is written to Vercel's
request logs, where a header value never is.** So treat this URL exactly as you treat the Supabase
service key — not in a chat, not in a screenshot, not in the repository — and rotate it if it has
been somewhere it should not have been.

Nothing else about the guard changed. No token, a wrong token, or an unset `VX_MCP_TOKEN` all
refuse.

**3. Check it.**

Open `https://www.vortexswimmingclub.com/api/mcp` in a browser — the plain URL, no token. You should
see `"configured": true` and the list of tools. That endpoint is safe to open: it names the tools
and nothing else, and it answers the same whether or not you gave it a token, so it cannot be
used to find out whether a guess was right.

### Other clients

Anything that can set a header should use one, because a header stays out of the logs:

```bash
curl -s https://www.vortexswimmingclub.com/api/mcp \
  -H "Authorization: Bearer $VX_MCP_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Both URLs are the same server. The header is checked first and is not a fallback: a request with
a stale header is refused rather than quietly rescued by the URL it was posted to.

## What it can answer

| Tool | Question it answers |
|---|---|
| `club_overview` | Every squad, its coach, age range and headcount |
| `find_swimmer` | Turn a name into an id — partial names are fine |
| `swimmer_progress` | One swimmer's PBs, race results, and attendance rate over a window |
| `attendance_summary` | Attendance per squad over a date range, and who is below a threshold |
| `fees_summary` | A month's invoices: issued, outstanding, per squad, and who has not paid |

## What it deliberately cannot see

This is the part worth reading, because the members of this club are children.

**What the connector can read is an allowlist, not a filter.** A filter is something you forget
to update when a column is added; an allowlist fails closed. It lives in
`src/lib/mcpData.ts`, and these are outside it entirely:

- **Documents** — birth certificates, passports, medical certificates. There is no question worth
  answering that needs these in a chat window.
- **Dates of birth** — identifying on their own. Ages are available; dates are not.
- **Parents' details** — names, emails, phone numbers.
- **Private messages** — the family↔coach thread is between them.
- **Lounge posts** — members' own words, written to the club and not to us.
- **InBody and wellness** — body composition, and how a child says they feel. Coaching data about
  a minor's body stays in the app, where the consent for it was given.

Two more properties, by construction:

- **Read only.** There is no tool that writes and no code path that could. A connector that can
  change the club is a connector that can be talked into changing the club.
- **It says when it cannot answer.** If the database is unreachable, `attendance_summary` returns
  an error — not an empty list, which would read as *"nobody missed training."*

## Rotating or revoking

Change `VX_MCP_TOKEN` in Vercel and redeploy. The old token stops working immediately — which
also means the old URL does, so update the connector in claude.ai with the new one. Because the
token is in the URL, rotating it is the way you revoke a URL that has been logged, pasted or
shared; do it whenever you are unsure where it has been.

To switch the connector off entirely, delete the variable — the route then refuses everything.

## A note on what you are sharing

Anything the connector returns goes into a Claude conversation: swimmers' names, squads, ages,
attendance and race times, and — in `fees_summary` — who owes money. That is the club's own
coaching and administrative picture, and the token is what keeps it to you.

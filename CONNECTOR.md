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
| URL | `https://vortexswimmingclub.com/api/mcp` |
| Authentication | Bearer token — paste the value from step 1 |

**3. Check it.**

Open `https://vortexswimmingclub.com/api/mcp` in a browser. You should see
`"configured": true` and the list of tools. That endpoint is safe to open — it names the tools
and nothing else.

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

Change `VX_MCP_TOKEN` in Vercel and redeploy. The old token stops working immediately; update it
in the claude.ai connector settings. To switch the connector off entirely, delete the variable —
the route then refuses everything.

## A note on what you are sharing

Anything the connector returns goes into a Claude conversation: swimmers' names, squads, ages,
attendance and race times, and — in `fees_summary` — who owes money. That is the club's own
coaching and administrative picture, and the token is what keeps it to you. Treat it like the
Supabase service key: not in a chat, not in a screenshot, not in the repository.

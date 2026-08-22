// The connector's endpoint for clients that can set a header: Authorization: Bearer <VX_MCP_TOKEN>.
//
// claude.ai's "Add custom connector" dialog cannot set one, so it uses the sibling route at
// /api/mcp/s/[token] instead. Both are the same server — see src/lib/mcpServer.ts, which is where
// the protocol, the tools and the reasons for the shape of all of it live.

import { handleRpc, describe } from "@/lib/mcpServer";

export const maxDuration = 30;

export async function POST(request: Request) {
  return handleRpc(request);
}

export async function GET() {
  return describe();
}

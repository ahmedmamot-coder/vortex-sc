// The same connector, with the secret in the URL instead of a header.
//
// This exists for one reason: claude.ai's "Add custom connector" dialog takes a name, a URL and an
// OAuth client id/secret — and nothing that becomes an Authorization header. The header route is
// the better one and stays; this is the one that can actually be pasted into that dialog.
//
// The whole URL is therefore the credential. It is in Vercel's request logs, which a header value
// never is, so it is rotated rather than trusted for ever — CONNECTOR.md says how, and says to
// treat the URL like the Supabase service key: not in a chat, not in a screenshot, not in the repo.

import { handleRpc, describe } from "@/lib/mcpServer";

export const maxDuration = 30;

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handleRpc(request, token);
}

// Answers exactly as the header route's GET does, right token or wrong: the tool names and no
// more. A health check that behaved differently for a valid token would be a way to test guesses.
export async function GET() {
  return describe();
}

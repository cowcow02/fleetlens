/** MCP tool server the spawned claude subprocess calls back into
 *  (streamable-HTTP), so tools run in-process sharing the session index.
 *  Unauthenticated by design — localhost-only threat model like the rest
 *  of the dashboard; do NOT port to team-server without adding auth. */

import { handleMcpMessage } from "@/lib/agent/mcp";
import { agentTools } from "@/lib/agent/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } },
      { status: 400 },
    );
  }
  const res = await handleMcpMessage(body, agentTools);
  if (res === null) return new Response(null, { status: 202 });
  return Response.json(res);
}

/** The streamable-HTTP transport probes GET for an event stream; we don't
 *  push server-initiated messages, so decline politely. */
export function GET() {
  return new Response(null, { status: 405 });
}

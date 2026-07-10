/**
 * MCP tool server for the Assistant's claude subprocess.
 *
 * The chat route spawns `claude -p --mcp-config` pointing back at this
 * endpoint (streamable-HTTP transport), so the agent loop runs inside the
 * local claude CLI while tools execute in-process here, sharing the web
 * server's session index and caches.
 */

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

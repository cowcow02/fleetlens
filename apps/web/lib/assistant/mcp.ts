/**
 * MCP (Model Context Protocol) message handler: initialize / tools/list /
 * tools/call over plain JSON-RPC (streamable-HTTP transport). No SDK
 * dependency — the claude CLI is the only client this will ever serve.
 */

import pkg from "../../package.json" with { type: "json" };

export type McpToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpTools = {
  defs: McpToolDef[];
  /** Returns the tool's text payload; throw to signal a tool error. */
  call: (name: string, args: unknown) => Promise<string>;
};

const PROTOCOL_VERSION = "2025-06-18";

type RpcRequest = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
};

function result(id: number | string | null, payload: unknown) {
  return { jsonrpc: "2.0", id, result: payload };
}

function error(id: number | string | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** Handle one JSON-RPC message. Returns the response object, or null for
 *  notifications (no id → nothing to send back). */
export async function handleMcpMessage(body: unknown, tools: McpTools): Promise<unknown | null> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return error(null, -32600, "invalid request");
  }
  const msg = body as RpcRequest;
  if (typeof msg.method !== "string") {
    return error(msg.id ?? null, -32600, "invalid request");
  }

  const isNotification = msg.id === undefined;
  if (isNotification) return null;
  const id = msg.id ?? null;

  switch (msg.method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion;
      return result(id, {
        protocolVersion: typeof requested === "string" ? requested : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "fleetlens", version: pkg.version },
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, { tools: tools.defs });
    case "tools/call": {
      const name = msg.params?.name;
      const args = msg.params?.arguments ?? {};
      if (typeof name !== "string") {
        return error(id, -32602, "tools/call requires params.name");
      }
      try {
        const text = await tools.call(name, args);
        return result(id, { content: [{ type: "text", text }] });
      } catch (err) {
        return result(id, {
          content: [{ type: "text", text: (err as Error).message }],
          isError: true,
        });
      }
    }
    default:
      return error(id, -32601, `method not found: ${msg.method}`);
  }
}

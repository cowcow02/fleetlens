import { describe, expect, test } from "vitest";
import { handleMcpMessage, type McpTools } from "./mcp";

const TOOLS: McpTools = {
  defs: [
    {
      name: "search_sessions",
      description: "Search sessions",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  ],
  call: async (name, args) => {
    if (name === "search_sessions") return JSON.stringify({ echo: (args as { query: string }).query });
    throw new Error(`unknown tool: ${name}`);
  },
};

function rpc(method: string, params?: unknown, id: number | string | null = 1) {
  return { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
}

describe("handleMcpMessage", () => {
  test("initialize returns protocol version, capabilities, and server info", async () => {
    const res = (await handleMcpMessage(
      rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude", version: "1" } }),
      TOOLS,
    )) as { jsonrpc: string; id: number; result: { protocolVersion: string; capabilities: { tools: object }; serverInfo: { name: string } } };
    expect(res.jsonrpc).toBe("2.0");
    expect(res.id).toBe(1);
    expect(res.result.protocolVersion).toBe("2025-06-18");
    expect(res.result.capabilities.tools).toBeDefined();
    expect(res.result.serverInfo.name).toBe("fleetlens");
  });

  test("notifications get no response", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, TOOLS);
    expect(res).toBeNull();
  });

  test("tools/list returns the tool definitions", async () => {
    const res = (await handleMcpMessage(rpc("tools/list"), TOOLS)) as {
      result: { tools: Array<{ name: string; inputSchema: object }> };
    };
    expect(res.result.tools).toHaveLength(1);
    expect(res.result.tools[0]!.name).toBe("search_sessions");
  });

  test("tools/call dispatches and wraps the result as text content", async () => {
    const res = (await handleMcpMessage(
      rpc("tools/call", { name: "search_sessions", arguments: { query: "daemon" } }),
      TOOLS,
    )) as { result: { content: Array<{ type: string; text: string }>; isError?: boolean } };
    expect(res.result.content[0]!.type).toBe("text");
    expect(JSON.parse(res.result.content[0]!.text)).toEqual({ echo: "daemon" });
    expect(res.result.isError).toBeUndefined();
  });

  test("tools/call surfaces tool failures as isError results, not protocol errors", async () => {
    const res = (await handleMcpMessage(
      rpc("tools/call", { name: "does_not_exist", arguments: {} }),
      TOOLS,
    )) as { result: { content: Array<{ type: string; text: string }>; isError: boolean } };
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0]!.text).toContain("unknown tool");
  });

  test("unknown methods return JSON-RPC method-not-found", async () => {
    const res = (await handleMcpMessage(rpc("resources/list"), TOOLS)) as {
      error: { code: number; message: string };
    };
    expect(res.error.code).toBe(-32601);
  });

  test("malformed bodies return JSON-RPC invalid-request", async () => {
    const res = (await handleMcpMessage("not an object", TOOLS)) as { error: { code: number } };
    expect(res.error.code).toBe(-32600);
  });

  test("ping returns an empty result", async () => {
    const res = (await handleMcpMessage(rpc("ping"), TOOLS)) as { result: object };
    expect(res.result).toEqual({});
  });
});

/**
 * Minimal line-delimited JSON-RPC over a Duplex stream.
 *
 * Each line is a JSON object:
 *   request   { id, method, params? }
 *   response  { id, result }  |  { id, error: { message } }
 *
 * Both sides can be both client and server simultaneously — request ids are
 * caller-scoped 32-bit ints.
 */

import type { Duplex } from "node:stream";

export type RpcHandler = (
  method: string,
  params: unknown,
) => Promise<unknown> | unknown;

export type RpcSession = {
  call: (method: string, params?: unknown, timeoutMs?: number) => Promise<unknown>;
  close: () => void;
};

export function attachRpc(stream: Duplex, handler: RpcHandler): RpcSession {
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  let buffer = "";
  let closed = false;

  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      void handleLine(line);
    }
  };

  const handleLine = async (line: string) => {
    let msg: { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message: string } };
    try {
      msg = JSON.parse(line);
    } catch {
      return; // malformed line — drop, peer will time out
    }
    if (msg.method !== undefined) {
      // It's a request.
      const id = msg.id;
      try {
        const result = await handler(msg.method, msg.params);
        if (id !== undefined) writeMsg({ id, result });
      } catch (err) {
        if (id !== undefined) {
          writeMsg({ id, error: { message: (err as Error).message || String(err) } });
        }
      }
      return;
    }
    // It's a response.
    if (msg.id === undefined) return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(msg.error.message));
    else entry.resolve(msg.result);
  };

  const writeMsg = (msg: unknown): void => {
    if (closed) return;
    try {
      stream.write(JSON.stringify(msg) + "\n");
    } catch {
      // Stream is dead; close handler will fire and clean up.
    }
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("connection closed"));
    }
    pending.clear();
    stream.off("data", onData);
  };

  stream.on("data", onData);
  stream.on("close", close);
  stream.on("error", close);

  return {
    call(method, params, timeoutMs = 10_000) {
      if (closed) return Promise.reject(new Error("rpc session closed"));
      const id = nextId++;
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`rpc timeout: ${method}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        writeMsg({ id, method, params });
      });
    },
    close,
  };
}

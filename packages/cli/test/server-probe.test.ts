import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { probeServerHealth } from "../src/server.js";

let srv: Server | undefined;

function listen(handler: Parameters<typeof createServer>[1]): Promise<number> {
  srv = createServer(handler);
  return new Promise((resolve) => {
    srv!.listen(0, "localhost", () => resolve((srv!.address() as AddressInfo).port));
  });
}

afterEach(
  () =>
    new Promise<void>((resolve) => {
      if (!srv) return resolve();
      srv.closeAllConnections();
      srv.close(() => resolve());
      srv = undefined;
    }),
);

describe("probeServerHealth", () => {
  it("treats an ok response as alive", async () => {
    const port = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
    expect(await probeServerHealth(port, 2_000)).toBe(true);
  });

  it("treats any completed response as alive — old bundles predate /api/health and 404 it", async () => {
    const port = await listen((_req, res) => {
      res.writeHead(404);
      res.end("not found");
    });
    expect(await probeServerHealth(port, 2_000)).toBe(true);
  });

  it("treats a connection refusal as dead", async () => {
    const port = await listen((_req, res) => res.end());
    await new Promise<void>((resolve) => srv!.close(() => resolve()));
    srv = undefined;
    expect(await probeServerHealth(port, 2_000)).toBe(false);
  });

  it("treats a server that accepts but never answers as dead (the GC-livelock shape)", async () => {
    const port = await listen(() => {
      /* never respond */
    });
    expect(await probeServerHealth(port, 500)).toBe(false);
  });
});

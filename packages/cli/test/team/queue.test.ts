import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { enqueuePayload, dequeuePayloads } from "../../src/team/queue.js";

function tempQueue(): string {
  const dir = mkdtempSync(join(tmpdir(), "fleetlens-queue-"));
  return join(dir, "ingest-queue.jsonl");
}

describe("enqueuePayload", () => {
  it("appends a JSONL entry to the queue file", () => {
    const q = tempQueue();
    enqueuePayload({ foo: 1 }, q);
    const lines = readFileSync(q, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.payload).toEqual({ foo: 1 });
    expect(entry.enqueuedAt).toBeDefined();
  });

  it("appends multiple payloads", () => {
    const q = tempQueue();
    enqueuePayload("a", q);
    enqueuePayload("b", q);
    const lines = readFileSync(q, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
  });
});

describe("dequeuePayloads", () => {
  it("returns queued payloads and clears the file", () => {
    const q = tempQueue();
    enqueuePayload({ x: 1 }, q);
    enqueuePayload({ x: 2 }, q);
    const result = dequeuePayloads(q);
    expect(result).toEqual([{ x: 1 }, { x: 2 }]);
    // File should be cleared
    expect(readFileSync(q, "utf8")).toBe("");
  });

  it("returns empty array when file does not exist", () => {
    const q = tempQueue(); // file never written
    expect(dequeuePayloads(q)).toEqual([]);
  });

  it("drops entries older than 7 days", () => {
    const q = tempQueue();
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const fresh = new Date().toISOString();
    writeFileSync(
      q,
      [
        JSON.stringify({ payload: "old", enqueuedAt: old }),
        JSON.stringify({ payload: "fresh", enqueuedAt: fresh }),
      ].join("\n") + "\n",
      "utf8"
    );
    const result = dequeuePayloads(q);
    expect(result).toEqual(["fresh"]);
  });
});

describe("overflow pruning", () => {
  it("prunes oldest half when file exceeds 10MB", () => {
    const q = tempQueue();
    // Write ~11MB worth of entries (each ~1100 bytes)
    const big = "x".repeat(1024);
    const lines: string[] = [];
    for (let i = 0; i < 11000; i++) {
      lines.push(JSON.stringify({ payload: { i, big }, enqueuedAt: new Date().toISOString() }));
    }
    writeFileSync(q, lines.join("\n") + "\n", "utf8");

    // Trigger prune via one more enqueue
    enqueuePayload({ trigger: true }, q);

    const remaining = readFileSync(q, "utf8").trim().split("\n").filter(Boolean);
    // Should have kept roughly half + 1
    expect(remaining.length).toBeLessThan(lines.length);
    expect(remaining.length).toBeGreaterThan(0);
  });
});

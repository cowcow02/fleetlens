import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  writeLastPushSuccess,
  writeLastPushFailure,
  clearLastPush,
  type LastPushRecord,
} from "../../src/team/last-push.js";
import type { IngestPayload } from "../../src/team/push.js";

const SAMPLE_PAYLOAD: IngestPayload = {
  ingestId: "ing_test",
  observedAt: "2026-05-21T10:00:00.000Z",
  dailyRollup: {
    day: "2026-05-20",
    agentTimeMs: 15_120_000,
    sessions: 23,
    toolCalls: 187,
    turns: 612,
    tokens: { input: 100_000, output: 50_000, cacheRead: 1_000_000, cacheWrite: 50_000 },
  },
  planTier: "pro-max-20x",
};

describe("team last-push artifact", () => {
  let dir: string;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "cclens-lastpush-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("writeLastPushSuccess writes ok:true with payload, no error", () => {
    writeLastPushSuccess(SAMPLE_PAYLOAD, dir);
    const record: LastPushRecord = JSON.parse(readFileSync(join(dir, "team-last-push.json"), "utf8"));
    expect(record.ok).toBe(true);
    expect(record.payload).toEqual(SAMPLE_PAYLOAD);
    expect(record.error).toBeUndefined();
    expect(typeof record.pushedAt).toBe("string");
    expect(Number.isFinite(Date.parse(record.pushedAt))).toBe(true);
  });

  it("writeLastPushFailure writes ok:false with error line", () => {
    writeLastPushFailure(SAMPLE_PAYLOAD, "Token revoked — run 'fleetlens team leave' then re-join", dir);
    const record: LastPushRecord = JSON.parse(readFileSync(join(dir, "team-last-push.json"), "utf8"));
    expect(record.ok).toBe(false);
    expect(record.error).toBe("Token revoked — run 'fleetlens team leave' then re-join");
    expect(record.payload).toEqual(SAMPLE_PAYLOAD);
  });

  it("second write overwrites first (single record, not append-only)", () => {
    writeLastPushSuccess(SAMPLE_PAYLOAD, dir);
    const second: IngestPayload = { ...SAMPLE_PAYLOAD, ingestId: "ing_second" };
    writeLastPushSuccess(second, dir);
    const record: LastPushRecord = JSON.parse(readFileSync(join(dir, "team-last-push.json"), "utf8"));
    expect(record.payload.ingestId).toBe("ing_second");
  });

  it("clearLastPush removes the file", () => {
    writeLastPushSuccess(SAMPLE_PAYLOAD, dir);
    clearLastPush(dir);
    expect(existsSync(join(dir, "team-last-push.json"))).toBe(false);
  });

  it("clearLastPush is a no-op when file does not exist", () => {
    expect(() => clearLastPush(dir)).not.toThrow();
  });
});

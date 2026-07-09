import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchZaiUsage, validateAndSnapshotZaiKey } from "../src/credentials.js";
import { cclensPath } from "@claude-lens/parser/fs";
import { readFileSync, existsSync, rmSync } from "node:fs";

const QUOTA = "https://api.z.ai/api/monitor/usage/quota/limit";

function mockQuotaOnce(body: unknown, status = 200): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: status === 200,
    status,
    statusText: status === 200 ? "OK" : "Err",
    json: async () => body,
  } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
  const p = cclensPath("usage.jsonl");
  if (existsSync(p)) rmSync(p);
});

describe("fetchZaiUsage", () => {
  it("parses 5h/7d/web-search from a valid key", async () => {
    mockQuotaOnce({
      data: {
        limits: [
          { type: "TOKENS_LIMIT", unit: 3, percentage: 40, nextResetTime: 1_700_000_000_000 },
          { type: "TOKENS_LIMIT", unit: 6, percentage: 52, nextResetTime: 1_701_000_000_000 },
          { type: "TIME_LIMIT", percentage: 0, nextResetTime: 1_785_202_810_995 },
        ],
        level: "lite",
      },
    });
    const snap = await fetchZaiUsage("fake-key");
    expect(snap.agent).toBe("zai");
    expect(snap.five_hour.utilization).toBe(40);
    expect(snap.seven_day.utilization).toBe(52);
    expect(snap.plan_type).toBe("lite");
    expect(snap.web_search_quota).toEqual({ used: 0, limit: 100 });
  });

  it("throws on a non-OK response (invalid key)", async () => {
    mockQuotaOnce({}, 401);
    await expect(fetchZaiUsage("bad-key")).rejects.toThrow(/rejected/);
  });

  it("throws when Z.ai returns 200 but a body error code (bad key)", async () => {
    // Z.ai answers HTTP 200 even for expired keys; the error is in
    // the body, so we must inspect code/success, not just res.ok.
    mockQuotaOnce({ code: 401, msg: "token expired or incorrect", success: false });
    await expect(fetchZaiUsage("bad-key")).rejects.toThrow(/rejected/);
  });
});

describe("validateAndSnapshotZaiKey", () => {
  it("appends a zai snapshot on a valid key", async () => {
    mockQuotaOnce({
      data: { limits: [{ type: "TOKENS_LIMIT", unit: 3, percentage: 10 }] },
    });
    const snap = await validateAndSnapshotZaiKey("good-key");
    expect(snap.five_hour.utilization).toBe(10);
    const log = cclensPath("usage.jsonl");
    expect(existsSync(log)).toBe(true);
    const line = JSON.parse(readFileSync(log, "utf8").trim().split("\n").at(-1)!);
    expect(line.agent).toBe("zai");
  });

  it("does NOT append and throws on an invalid key", async () => {
    mockQuotaOnce({}, 403);
    await expect(validateAndSnapshotZaiKey("bad-key")).rejects.toThrow(/rejected/);
    expect(existsSync(cclensPath("usage.jsonl"))).toBe(false);
  });
});

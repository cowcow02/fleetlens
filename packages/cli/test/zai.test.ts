import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { fetchZaiUsage, ZaiApiError } from "../src/usage/zai.js";

/**
 * Exercises the network + mapping logic in fetchZaiUsage without hitting the
 * real Z.ai API and WITHOUT relying on any real credential. The credential
 * store (~/.cclens/credentials.json) is the sole key source, so each test
 * writes a temp store via CCLENS_HOME and mocks fetch.
 */
const FAKE_KEY = "test-key-not-real";
const os = await import("node:os");

// Temp credential-store dir, isolated from the real ~/.cclens.
const TMP_HOME = await import("node:fs").then((fs) =>
  fs.mkdtempSync(join(os.tmpdir(), "zai-test-")),
);
const STORE = join(TMP_HOME, "credentials.json");

function writeStore(key: string | null): void {
  const body = key === null ? {} : { zai: { apiKey: key } };
  writeFileSync(STORE, JSON.stringify(body), "utf8");
}

beforeEach(() => {
  process.env.CCLENS_HOME = TMP_HOME;
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ZAI_API_KEY;
  delete process.env.GLM_API_KEY;
  delete process.env.CCLENS_HOME;
});

function mockFetchOnce(handlers: Record<string, unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
    for (const [suffix, body] of Object.entries(handlers)) {
      if (url.includes(suffix)) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => body,
        } as Response;
      }
    }
    return { ok: true, status: 200, statusText: "OK", json: async () => ({}) } as Response;
  }) as typeof fetch);
}

describe("fetchZaiUsage", () => {
  it("throws no_key when no credential is available", async () => {
    writeStore(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({} as Response);
    await expect(fetchZaiUsage()).rejects.toBeInstanceOf(ZaiApiError);
    // No network call should be attempted without a key.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("classifies TOKENS_LIMIT by unit: 3 → 5h, 6 → 7d", async () => {
    writeStore(FAKE_KEY);
    const fetchSpy = mockFetchOnce({
      "/quota/limit": {
        data: {
          limits: [
            { type: "TOKENS_LIMIT", unit: 3, percentage: 40.5, nextResetTime: 1_700_000_000_000 },
            { type: "TOKENS_LIMIT", unit: 6, percentage: 52.0, nextResetTime: 1_701_000_000_000 },
          ],
          level: "lite",
        },
      },
      "/subscription/list": { data: [{ productName: "GLM Coding Lite" }] },
    });

    const snap = await fetchZaiUsage();
    expect(snap.agent).toBe("zai");
    expect(snap.five_hour.utilization).toBe(40.5);
    expect(snap.seven_day.utilization).toBe(52.0);
    expect(snap.plan_type).toBe("GLM Coding Lite");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("captures the monthly web-search TIME_LIMIT as a percentage meter", async () => {
    writeStore(FAKE_KEY);
    mockFetchOnce({
      "/quota/limit": {
        data: {
          limits: [
            {
              type: "TIME_LIMIT",
              usage: 100,
              remaining: 100,
              percentage: 0,
              nextResetTime: 1_785_202_810_995,
              usageDetails: [{ modelCode: "search-prime", usage: 0 }],
            },
            { type: "TOKENS_LIMIT", unit: 3, percentage: 10 },
          ],
        },
      },
    });

    const snap = await fetchZaiUsage();
    // Matches the portal: percentage is the displayed meter, not usage/remaining.
    expect(snap.web_search_quota).toEqual({ used: 0, limit: 100 });
  });

  it("continues without a plan name when subscription/list fails", async () => {
    writeStore(FAKE_KEY);
    vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
      if (url.includes("/quota/limit")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            data: { limits: [{ type: "TOKENS_LIMIT", unit: 3, percentage: 5 }] },
          }),
        } as Response;
      }
      return { ok: false, status: 500, statusText: "Error", json: async () => ({}) } as Response;
    }) as typeof fetch);

    const snap = await fetchZaiUsage();
    expect(snap.plan_type).toBeNull();
    expect(snap.five_hour.utilization).toBe(5);
  });

  it("throws on a non-OK quota response", async () => {
    writeStore(FAKE_KEY);
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({}),
    } as Response);

    const err = await fetchZaiUsage().catch((e) => e);
    expect(err).toBeInstanceOf(ZaiApiError);
    expect((err as ZaiApiError).code).toBe("http");
  });
});

import { describe, expect, it } from "vitest";
import {
  ContentLengthDecoder,
  CopilotApiError,
  nextCopilotMonthlyReset,
  parseCopilotQuota,
} from "../../src/usage/copilot.js";

function frame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"),
    body,
  ]);
}

describe("parseCopilotQuota", () => {
  const now = Date.parse("2026-07-15T05:00:00.000Z");

  it("maps token-based chat quota into a monthly AI-credit window", () => {
    const parsed = parseCopilotQuota({
      quotaSnapshots: {
        chat: {
          isUnlimitedEntitlement: false,
          entitlementRequests: 200,
          usedRequests: 1,
          remainingPercentage: 99.5,
          resetDate: "2026-07-15T05:00:00.000Z",
          hasQuota: true,
          tokenBasedBilling: true,
        },
      },
    }, now);

    expect(parsed.agent).toBe("copilot");
    expect(parsed.five_hour.utilization).toBeNull();
    expect(parsed.seven_day.utilization).toBeNull();
    expect(parsed.monthly).toEqual({
      utilization: 0.5,
      resets_at: "2026-08-01T00:00:00.000Z",
    });
    expect(parsed.monthly_quota).toEqual({
      used: 1,
      limit: 200,
      remaining: 199,
      unit: "ai-credits",
      unlimited: false,
    });
    expect(parsed.plan_type).toBe("AI credits");
  });

  it("falls back to legacy premium interactions", () => {
    const parsed = parseCopilotQuota({
      quotaSnapshots: {
        chat: { entitlementRequests: 0 },
        premium_interactions: {
          entitlementRequests: 300,
          usedRequests: 75,
          remainingPercentage: 75,
          tokenBasedBilling: false,
        },
      },
    }, now);
    expect(parsed.monthly?.utilization).toBe(25);
    expect(parsed.monthly_quota?.unit).toBe("premium-requests");
  });

  it("uses a future SDK reset date when one is reported", () => {
    const parsed = parseCopilotQuota({
      quotaSnapshots: {
        chat: {
          entitlementRequests: 200,
          usedRequests: 20,
          remainingPercentage: 90,
          resetDate: "2026-08-03T12:00:00.000Z",
          tokenBasedBilling: true,
        },
      },
    }, now);
    expect(parsed.monthly?.resets_at).toBe("2026-08-03T12:00:00.000Z");
  });

  it("keeps unlimited plans unmetered", () => {
    const parsed = parseCopilotQuota({
      quotaSnapshots: {
        chat: {
          isUnlimitedEntitlement: true,
          entitlementRequests: -1,
          usedRequests: 20,
          remainingPercentage: 100,
          tokenBasedBilling: true,
        },
      },
    }, now);
    expect(parsed.monthly?.utilization).toBeNull();
    expect(parsed.monthly_quota?.unlimited).toBe(true);
  });

  it("rejects malformed quota responses", () => {
    expect(() => parseCopilotQuota({})).toThrow(CopilotApiError);
  });
});

describe("Copilot quota transport", () => {
  it("rolls the monthly reset through year boundaries", () => {
    expect(nextCopilotMonthlyReset(Date.parse("2026-12-31T23:59:59Z")))
      .toBe("2027-01-01T00:00:00.000Z");
  });

  it("decodes fragmented and back-to-back JSON-RPC frames", () => {
    const decoder = new ContentLengthDecoder();
    const first = frame({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    const second = frame({ jsonrpc: "2.0", id: 2, result: { quota: 1 } });
    expect(decoder.push(first.subarray(0, 12))).toEqual([]);
    expect(decoder.push(Buffer.concat([first.subarray(12), second]))).toEqual([
      { jsonrpc: "2.0", id: 1, result: { ok: true } },
      { jsonrpc: "2.0", id: 2, result: { quota: 1 } },
    ]);
  });
});

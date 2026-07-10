import { describe, it, expect } from "vitest";
import { parseGrokCreditsConfig, GrokApiError } from "../../src/usage/grok.js";

describe("parseGrokCreditsConfig", () => {
  it("maps weekly creditUsagePercent onto the shared pool", () => {
    const parsed = parseGrokCreditsConfig({
      config: {
        creditUsagePercent: 44,
        currentPeriod: {
          type: "USAGE_PERIOD_TYPE_WEEKLY",
          start: "2026-07-08T00:00:00+00:00",
          end: "2026-07-15T00:00:00+00:00",
        },
        onDemandCap: { val: 0 },
        isUnifiedBillingUser: true,
      },
    });
    expect(parsed.utilization).toBe(44);
    expect(parsed.period_type).toBe("USAGE_PERIOD_TYPE_WEEKLY");
    expect(parsed.resets_at).toBe(new Date("2026-07-15T00:00:00+00:00").toISOString());
    expect(parsed.on_demand_cap).toBe(0);
  });

  it("treats absent creditUsagePercent as 0% (proto-JSON omits zeros)", () => {
    const parsed = parseGrokCreditsConfig({
      config: {
        currentPeriod: {
          type: "USAGE_PERIOD_TYPE_WEEKLY",
          start: "2026-07-08T00:00:00Z",
          end: "2026-07-15T00:00:00Z",
        },
      },
    });
    expect(parsed.utilization).toBe(0);
  });

  it("rejects non-numeric creditUsagePercent", () => {
    expect(() =>
      parseGrokCreditsConfig({
        config: {
          creditUsagePercent: "nope",
          currentPeriod: {
            type: "USAGE_PERIOD_TYPE_WEEKLY",
            start: "2026-07-08T00:00:00Z",
            end: "2026-07-15T00:00:00Z",
          },
        },
      }),
    ).toThrow(GrokApiError);
  });
});

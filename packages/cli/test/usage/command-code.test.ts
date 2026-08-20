import { describe, it, expect } from "vitest";
import {
  parseCommandCodeCredits,
  parseCommandCodeMonthly,
  parseCommandCodeSubscription,
  parseCommandCodeWindow,
  parseCommandCodeWindows,
  planLabelFromId,
  planMonthlyCredits,
  CommandCodeApiError,
} from "../../src/usage/command-code.js";

describe("parseCommandCodeCredits", () => {
  it("reads remaining monthly credits", () => {
    const parsed = parseCommandCodeCredits({
      credits: { monthlyCredits: 4.036, purchasedCredits: 1.5, freeCredits: 0, planId: "individual-go" },
      windowLimits: { fiveHour: { used: 0, cap: 3 } },
    });
    expect(parsed.remaining).toBe(4.036);
    expect(parsed.purchased).toBe(1.5);
    expect(parsed.planId).toBe("individual-go");
  });

  it("rejects a body without credits", () => {
    expect(() => parseCommandCodeCredits({ windowLimits: {} })).toThrow(CommandCodeApiError);
  });
});

describe("parseCommandCodeMonthly", () => {
  it("maps remaining credits onto the monthly pool", () => {
    const parsed = parseCommandCodeMonthly({
      credits: { remaining: 4.036, purchased: 0, free: 0, planId: "individual-go" },
      subscription: {
        plan_type: "Go",
        planId: "individual-go",
        currentPeriodEnd: "2026-09-05T15:55:49.000Z",
      },
    });
    expect(parsed.plan_type).toBe("Go");
    expect(parsed.monthly.utilization).toBeCloseTo(59.6, 5);
    expect(parsed.monthly.resets_at).toBe("2026-09-05T15:55:49.000Z");
    expect(parsed.monthly_quota).toEqual({
      used: 5.96,
      limit: 10,
      remaining: 4.04,
      unit: "credits",
      unlimited: false,
    });
  });

  it("leaves utilization null when the plan allocation is unknown", () => {
    const parsed = parseCommandCodeMonthly({
      credits: { remaining: 4, purchased: 0, free: 0, planId: null },
      subscription: { plan_type: null, planId: null, currentPeriodEnd: null },
    });
    expect(parsed.monthly.utilization).toBeNull();
    expect(parsed.monthly_quota.limit).toBeNull();
    expect(parsed.monthly_quota.remaining).toBe(4);
  });
});

describe("parseCommandCodeWindows", () => {
  it("maps fiveHour and weekly onto five_hour / seven_day", () => {
    const parsed = parseCommandCodeWindows({
      credits: { monthlyCredits: 4.03 },
      windowLimits: {
        fiveHour: { used: 0.01, cap: 3, exceeded: false, resetAt: 1787100000000 },
        weekly: { used: 5.97, cap: 6, exceeded: false, resetAt: 1787091170702 },
      },
    });
    expect(parsed.five_hour.utilization).toBeCloseTo((0.01 / 3) * 100, 8);
    expect(parsed.five_hour.resets_at).toBe(new Date(1787100000000).toISOString());
    expect(parsed.seven_day.utilization).toBeCloseTo((5.97 / 6) * 100, 8);
  });

  it("treats resetAt 0 as unknown", () => {
    expect(parseCommandCodeWindow({ used: 0, cap: 3, resetAt: 0 }).resets_at).toBeNull();
  });
});

describe("planLabelFromId", () => {
  it("maps known plan ids to display names", () => {
    expect(planLabelFromId("individual-go")).toBe("Go");
    expect(planLabelFromId("individual-goat")).toBe("GOAT");
    expect(planLabelFromId("individual-pro-v1")).toBe("Pro");
  });

  it("matches a prefix when the id has a suffix", () => {
    expect(planLabelFromId("individual-go-promo")).toBe("Go");
  });

  it("returns the raw id when unknown", () => {
    expect(planLabelFromId("enterprise-custom")).toBe("enterprise-custom");
    expect(planLabelFromId(null)).toBeNull();
  });
});

describe("planMonthlyCredits", () => {
  it("returns the Go plan allocation", () => {
    expect(planMonthlyCredits("individual-go")).toBe(10);
    expect(planMonthlyCredits("individual-goat")).toBe(70);
    expect(planMonthlyCredits(null)).toBeNull();
  });
});

describe("parseCommandCodeSubscription", () => {
  it("reads planId and period end from the subscription wrapper", () => {
    expect(
      parseCommandCodeSubscription({
        success: true,
        data: {
          planId: "individual-go",
          status: "active",
          currentPeriodEnd: "2026-09-05T15:55:49.000Z",
        },
      }),
    ).toEqual({
      plan_type: "Go",
      planId: "individual-go",
      currentPeriodEnd: "2026-09-05T15:55:49.000Z",
    });
  });
});

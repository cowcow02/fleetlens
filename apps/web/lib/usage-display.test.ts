import { describe, expect, it } from "vitest";
import { copilotQuotaPresentation, visibleUsageAgents } from "./usage-display";

describe("visibleUsageAgents", () => {
  it("keeps unobserved providers out of an empty usage page", () => {
    expect(visibleUsageAgents([])).toEqual(["claude-code"]);
  });

  it("shows Grok only after a real Grok usage sample exists", () => {
    expect(visibleUsageAgents([{ agent: "copilot" }])).toEqual([
      "copilot",
      "claude-code",
    ]);
    expect(visibleUsageAgents([{ agent: "grok" }])).toEqual([
      "grok",
      "claude-code",
    ]);
  });

  it("treats legacy snapshots without an agent as Claude Code", () => {
    expect(visibleUsageAgents([{}])).toEqual(["claude-code"]);
  });
});

describe("copilotQuotaPresentation", () => {
  it("does not claim unlimited use when Copilot omits a personal limit", () => {
    const display = copilotQuotaPresentation(null, {
      used: 20,
      limit: -1,
      remaining: null,
      unit: "ai-credits",
      unlimited: true,
    });

    expect(display).toEqual({
      headline: "Limit not reported",
      detail: "20 AI credits reported by Copilot",
      limitNotReported: true,
    });
    expect(JSON.stringify(display).toLowerCase()).not.toContain("unlimited");
  });

  it("keeps exact usage and remaining credits for personal allowances", () => {
    expect(copilotQuotaPresentation(1.5, {
      used: 3,
      limit: 200,
      remaining: 197,
      unit: "ai-credits",
      unlimited: false,
    })).toEqual({
      headline: "1.5%",
      detail: "3 of 200 AI credits used · 197 remaining",
      limitNotReported: false,
    });
  });
});

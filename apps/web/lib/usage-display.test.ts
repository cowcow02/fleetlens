import { describe, expect, it } from "vitest";
import {
  copilotQuotaPresentation,
  copilotUnitLabel,
  sidebarUsageRows,
  sortUsageAgents,
  visibleUsageAgents,
} from "./usage-display";

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

describe("sortUsageAgents", () => {
  it("puts Claude first and sorts the rest alphabetically", () => {
    expect(sortUsageAgents(["grok", "claude-code", "codex", "zai"])).toEqual([
      "claude-code",
      "codex",
      "grok",
      "zai",
    ]);
  });
});

describe("sidebarUsageRows", () => {
  const win = (u: number) => ({ utilization: u, resets_at: null });

  it("returns empty when there is no snapshot", () => {
    expect(sidebarUsageRows("claude-code", null)).toEqual([]);
  });

  it("shows 5h + 7d for Claude, and optional Sonnet", () => {
    const snap = {
      five_hour: win(10),
      seven_day: win(40),
      seven_day_sonnet: win(12),
    };
    expect(sidebarUsageRows("claude-code", snap).map((r) => r.label)).toEqual(["5h", "7d"]);
    expect(
      sidebarUsageRows("claude-code", snap, { showSonnet: true }).map((r) => r.label),
    ).toEqual(["5h", "7d", "Sonnet 7d"]);
  });

  it("hides the retired Codex 5h meter when utilization is null", () => {
    const snap = { five_hour: { utilization: null, resets_at: null }, seven_day: win(55) };
    expect(sidebarUsageRows("codex", snap).map((r) => r.label)).toEqual(["7d"]);
  });

  it("uses monthly for Copilot and 7d-only for Grok", () => {
    expect(
      sidebarUsageRows("copilot", { monthly: win(3) }).map((r) => r.label),
    ).toEqual(["Monthly"]);
    expect(
      sidebarUsageRows("grok", { seven_day: win(80) }).map((r) => r.label),
    ).toEqual(["7d"]);
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

  it("omits the detail when Copilot reports neither a personal limit nor usage", () => {
    expect(copilotQuotaPresentation(null, {
      used: null,
      limit: -1,
      remaining: null,
      unit: "ai-credits",
      unlimited: true,
    })).toEqual({
      headline: "Limit not reported",
      detail: null,
      limitNotReported: true,
    });
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

  it("uses one unit mapping for headings and quota details", () => {
    expect(copilotUnitLabel("ai-credits")).toBe("AI credits");
    expect(copilotUnitLabel("premium-requests")).toBe("premium requests");
  });
});

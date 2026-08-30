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
    expect(visibleUsageAgents([{ agent: "command-code" }])).toEqual([
      "command-code",
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

  it("shows monthly + 5h + weekly for Command Code", () => {
    expect(
      sidebarUsageRows("command-code", {
        monthly: win(59.6),
        five_hour: win(0.3),
        seven_day: win(99.5),
      }).map((r) => r.label),
    ).toEqual(["5h", "wk", "Monthly"]);
  });

  it("derives Copilot monthly windowMs from the calendar month of resets_at", () => {
    // resets_at = Mar 1 00:00 UTC → previous month is February (non-leap 2026)
    const febMs =
      Date.UTC(2026, 2, 1) - Date.UTC(2026, 1, 1); // Mar 1 − Feb 1
    const rows = sidebarUsageRows("copilot", {
      monthly: { utilization: 20, resets_at: "2026-03-01T00:00:00.000Z" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.windowMs).toBe(febMs);
    expect(rows[0]!.windowMs).toBe(28 * 24 * 3_600_000);
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
    expect(copilotUnitLabel("credits")).toBe("credits");
    expect(copilotUnitLabel("usd")).toBe("USD");
  });

  it("formats KaiHK wallet spend with dollar signs", () => {
    expect(
      copilotQuotaPresentation(36.64, {
        used: 18.32,
        limit: 50,
        remaining: 31.68,
        unit: "usd",
        unlimited: false,
      }),
    ).toEqual({
      headline: "36.6%",
      detail: "$18.32 of $50.00 used · $31.68 remaining",
      limitNotReported: false,
    });
  });
});

describe("kaihk sidebar", () => {
  it("shows only the monthly meter for KaiHK keys", () => {
    expect(
      sidebarUsageRows("kaihk", { monthly: { utilization: 36.64, resets_at: null } }).map(
        (r) => r.label,
      ),
    ).toEqual(["Monthly"]);
    expect(
      sidebarUsageRows("kaihk-2", { monthly: { utilization: 1, resets_at: null } }).map(
        (r) => r.label,
      ),
    ).toEqual(["Monthly"]);
  });
});

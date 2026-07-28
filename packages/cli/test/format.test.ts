import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  formatMultiAgentUsage,
  formatUsage,
  layoutForColumns,
} from "../src/usage/format.js";
import type { UsageSnapshot, UsageWindow } from "../src/usage/api.js";

const emptyWindow: UsageWindow = { utilization: null, resets_at: null };

function baseSnapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    captured_at: "2026-06-24T12:00:00Z",
    five_hour: emptyWindow,
    seven_day: emptyWindow,
    seven_day_opus: null,
    seven_day_sonnet: null,
    seven_day_oauth_apps: null,
    seven_day_cowork: null,
    extra_usage: null,
    ...overrides,
  };
}

// ANSI-strip helper — formatUsage embeds color/bold/dim sequences for the TTY.
// Asserting against the cooked text is robust to color changes.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
const strip = (s: string) => s.replace(ANSI, "");

describe("formatUsage", () => {
  beforeEach(() => {
    // Lock 'now' so the captured-at relative line ("captured Xs ago" /
    // "in Xs") is deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Force desktop width so CI terminals with a tiny COLUMNS don't flip layout.
  const wide = { columns: 100 };

  it("renders the header even when no windows have data", () => {
    const out = strip(formatUsage(baseSnapshot(), wide));
    expect(out).toContain("Fleetlens Usage");
    expect(out).toContain("Claude Code");
    // Per-agent age is always emitted so multi-agent stale data is obvious.
    expect(out).toContain("sampled");
    expect(out).not.toMatch(/%/);
  });

  it("renders a 0.0% bar in the green band", () => {
    const raw = formatUsage(
      baseSnapshot({ five_hour: { utilization: 0, resets_at: null } }),
      wide,
    );
    expect(strip(raw)).toContain("0.0%");
    // Green ANSI escape \x1b[32m must be present somewhere in the rendered bar.
    expect(raw).toContain("\x1b[32m");
  });

  it("renders a 50% bar in the green band (mid-green)", () => {
    const raw = formatUsage(
      baseSnapshot({ five_hour: { utilization: 50, resets_at: null } }),
      wide,
    );
    expect(strip(raw)).toContain("50.0%");
    expect(raw).toContain("\x1b[32m");
    expect(raw).not.toContain("\x1b[33m");
    expect(raw).not.toContain("\x1b[31m");
  });

  it("renders a 70% bar in the yellow band (lower cutoff is inclusive)", () => {
    // Color thresholds in renderBar: `clamped >= 90 ? RED : clamped >= 70 ? YELLOW : GREEN`.
    // 70.0 must turn yellow, not green.
    const raw = formatUsage(
      baseSnapshot({ five_hour: { utilization: 70, resets_at: null } }),
      wide,
    );
    expect(strip(raw)).toContain("70.0%");
    expect(raw).toContain("\x1b[33m");
    expect(raw).not.toContain("\x1b[31m");
  });

  it("renders a 90% bar in the red band (upper cutoff is inclusive)", () => {
    // The `>= 90` branch wins over `>= 70`, so 90.0% is red, not yellow.
    const raw = formatUsage(
      baseSnapshot({ five_hour: { utilization: 90, resets_at: null } }),
      wide,
    );
    expect(strip(raw)).toContain("90.0%");
    expect(raw).toContain("\x1b[31m");
  });

  it("renders the extra_usage section when enabled, including credits", () => {
    const out = strip(formatUsage(baseSnapshot({
      agent: "claude-code",
      extra_usage: {
        is_enabled: true,
        utilization: 75,
        used_credits: 100,
        monthly_limit: 200,
      },
    }), wide));
    expect(out).toContain("Extra usage");
    expect(out).toContain("75.0%");
    expect(out).toContain("100 / 200 credits");
  });
});

describe("formatMultiAgentUsage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("orders Claude before Codex and shows agent-specific windows", () => {
    const out = strip(
      formatMultiAgentUsage(
        {
        codex: baseSnapshot({
          agent: "codex",
          five_hour: { utilization: null, resets_at: null },
          seven_day: { utilization: 40, resets_at: null },
        }),
        "claude-code": baseSnapshot({
          agent: "claude-code",
          five_hour: { utilization: 10, resets_at: null },
          seven_day: { utilization: 20, resets_at: null },
        }),
        copilot: baseSnapshot({
          agent: "copilot",
          monthly: { utilization: 2, resets_at: null },
        }),
        },
        { columns: 100 },
      ),
    );
    expect(out).toContain("Fleetlens Usage");
    // Claude block before Codex in the string.
    expect(out.indexOf("Claude Code")).toBeLessThan(out.indexOf("Codex"));
    expect(out).toContain("GitHub Copilot");
    expect(out).toContain("Monthly");
    expect(out).toContain("40.0%");
    expect(out).toContain("10.0%");
  });

  it("marks watch mode in the header", () => {
    const out = strip(
      formatMultiAgentUsage(
        {
          grok: baseSnapshot({
            agent: "grok",
            seven_day: { utilization: 16, resets_at: null },
          }),
        },
        { watch: true, intervalSec: 3, columns: 100 },
      ),
    );
    expect(out).toContain("live · every 3s · Ctrl+C to quit");
    expect(out).toContain("Grok Build");
  });

  it("uses a compact no-bar layout on phone-width columns", () => {
    const out = strip(
      formatMultiAgentUsage(
        {
          "claude-code": baseSnapshot({
            agent: "claude-code",
            five_hour: { utilization: 12, resets_at: "2026-06-24T16:00:00Z" },
            seven_day: { utilization: 40, resets_at: null },
          }),
        },
        { columns: 36 },
      ),
    );
    expect(out).toContain("Claude"); // shortLabel
    expect(out).toContain("5h");
    expect(out).toContain("7d");
    expect(out).toContain("12.0%");
    // No full-width bar glyphs on narrow.
    expect(out).not.toContain("█");
    // Every content line should fit a 36-col phone (allow small pad).
    for (const line of out.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });
});

describe("layoutForColumns", () => {
  it("classifies narrow / medium / wide", () => {
    expect(layoutForColumns(36).mode).toBe("narrow");
    expect(layoutForColumns(36).barWidth).toBe(0);
    expect(layoutForColumns(60).mode).toBe("medium");
    expect(layoutForColumns(60).barWidth).toBeGreaterThan(0);
    expect(layoutForColumns(100).mode).toBe("wide");
    expect(layoutForColumns(100).barWidth).toBe(40);
  });
});

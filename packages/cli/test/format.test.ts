import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { formatUsage } from "../src/usage/format.js";
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

  it("renders the header even when no windows have data", () => {
    const out = strip(formatUsage(baseSnapshot()));
    expect(out).toContain("Claude Code Usage");
    // No utilization rows because every window is null. The 'captured' footer
    // is always emitted.
    expect(out).toContain("captured");
    expect(out).not.toMatch(/%/);
  });

  it("renders a 0.0% bar in the green band", () => {
    const raw = formatUsage(
      baseSnapshot({ five_hour: { utilization: 0, resets_at: null } }),
    );
    expect(strip(raw)).toContain("0.0%");
    // Green ANSI escape \x1b[32m must be present somewhere in the rendered bar.
    expect(raw).toContain("\x1b[32m");
  });

  it("renders a 50% bar in the green band (mid-green)", () => {
    const raw = formatUsage(
      baseSnapshot({ five_hour: { utilization: 50, resets_at: null } }),
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
    );
    expect(strip(raw)).toContain("70.0%");
    expect(raw).toContain("\x1b[33m");
    expect(raw).not.toContain("\x1b[31m");
  });

  it("renders a 90% bar in the red band (upper cutoff is inclusive)", () => {
    // The `>= 90` branch wins over `>= 70`, so 90.0% is red, not yellow.
    const raw = formatUsage(
      baseSnapshot({ five_hour: { utilization: 90, resets_at: null } }),
    );
    expect(strip(raw)).toContain("90.0%");
    expect(raw).toContain("\x1b[31m");
  });

  it("renders the extra_usage section when enabled, including credits", () => {
    const out = strip(formatUsage(baseSnapshot({
      extra_usage: {
        is_enabled: true,
        utilization: 75,
        used_credits: 100,
        monthly_limit: 200,
      },
    })));
    expect(out).toContain("Extra usage");
    expect(out).toContain("75.0%");
    expect(out).toContain("100 / 200 credits");
  });
});

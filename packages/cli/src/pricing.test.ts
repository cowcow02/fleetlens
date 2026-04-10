import { describe, it, expect } from "vitest";
import { estimateCost } from "./pricing.js";
import type { Usage } from "@claude-lens/parser";

describe("estimateCost", () => {
  it("calculates cost for known model", () => {
    const usage: Usage = { input: 1000, output: 500, cacheRead: 2000, cacheWrite: 300 };
    const cost = estimateCost("claude-sonnet-4-20250514", usage);
    expect(cost).not.toBeNull();
    expect(cost!).toBeGreaterThan(0);
  });

  it("returns null for unknown model", () => {
    const usage: Usage = { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 };
    const cost = estimateCost("unknown-model-123", usage);
    expect(cost).toBeNull();
  });

  it("matches prefix for model variants", () => {
    const usage: Usage = { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 };
    const a = estimateCost("claude-sonnet-4-20250514", usage);
    const b = estimateCost("claude-sonnet-4-6-20260101", usage);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });

  it("calculates expected cost for opus", () => {
    // 1M input tokens at $15/M = $15
    const usage: Usage = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 };
    const cost = estimateCost("claude-opus-4-20250514", usage);
    expect(cost).toBe(15);
  });
});

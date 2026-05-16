import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  __testing,
  getPlanTier,
  readCachedProfile,
  writeCachedProfile,
  type AnthropicProfile,
} from "../../src/usage/profile.js";

describe("mapRateLimitTier", () => {
  const cases: Array<[string | null, string]> = [
    ["default_claude_pro", "pro"],
    ["default_claude_max", "pro-max"],
    ["default_claude_max_5x", "pro-max"],
    ["default_claude_max_20x", "pro-max-20x"],
    ["something_unknown", "custom"],
    [null, "custom"],
  ];
  for (const [input, expected] of cases) {
    it(`maps ${input ?? "null"} → ${expected}`, () => {
      expect(__testing.mapRateLimitTier(input)).toBe(expected);
    });
  }
});

describe("profile cache", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fleetlens-profile-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("readCachedProfile returns null when file is missing", () => {
    expect(readCachedProfile(join(dir, "missing.json"))).toBeNull();
  });

  it("write + read round-trips", () => {
    const cachePath = join(dir, "profile.json");
    const profile: AnthropicProfile = {
      planTier: "pro-max-20x",
      rateLimitTier: "default_claude_max_20x",
      organizationType: "claude_max",
    };
    writeCachedProfile(cachePath, profile, 1234);
    const read = readCachedProfile(cachePath);
    expect(read).toEqual({ fetchedAtMs: 1234, profile });
  });
});

describe("getPlanTier", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fleetlens-profile-getter-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("uses cache while fresh", async () => {
    const cachePath = join(dir, "profile.json");
    writeCachedProfile(
      cachePath,
      { planTier: "pro-max", rateLimitTier: "default_claude_max", organizationType: "claude_max" },
      1_000_000_000_000,
    );
    let fetcherCalled = 0;
    const tier = await getPlanTier(cachePath, 1_000_000_000_000 + 60_000, async () => {
      fetcherCalled++;
      return null;
    });
    expect(tier).toBe("pro-max");
    expect(fetcherCalled).toBe(0);
  });

  it("re-fetches once cache is older than 24h", async () => {
    const cachePath = join(dir, "profile.json");
    const baseMs = 1_000_000_000_000;
    writeCachedProfile(
      cachePath,
      { planTier: "pro-max", rateLimitTier: "default_claude_max", organizationType: "claude_max" },
      baseMs,
    );
    let fetcherCalled = 0;
    const tier = await getPlanTier(
      cachePath,
      baseMs + 25 * 60 * 60 * 1000,
      async () => {
        fetcherCalled++;
        return {
          planTier: "pro-max-20x",
          rateLimitTier: "default_claude_max_20x",
          organizationType: "claude_max",
        };
      },
    );
    expect(tier).toBe("pro-max-20x");
    expect(fetcherCalled).toBe(1);
  });

  it("falls back to stale cache if fetch fails", async () => {
    const cachePath = join(dir, "profile.json");
    const baseMs = 1_000_000_000_000;
    writeCachedProfile(
      cachePath,
      { planTier: "pro-max", rateLimitTier: "default_claude_max", organizationType: "claude_max" },
      baseMs,
    );
    const tier = await getPlanTier(
      cachePath,
      baseMs + 25 * 60 * 60 * 1000,
      async () => null,
    );
    expect(tier).toBe("pro-max");
  });

  it("returns null when no cache and fetch fails", async () => {
    const tier = await getPlanTier(join(dir, "missing.json"), Date.now(), async () => null);
    expect(tier).toBeNull();
  });
});

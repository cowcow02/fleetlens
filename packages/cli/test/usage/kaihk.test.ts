import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverKaihkProviders,
  formatKaihkUsd,
  isKaihkAgent,
  kaihkTitle,
  parseKaihkSnapshot,
  planUsd,
} from "../../src/usage/kaihk.js";

describe("discoverKaihkProviders", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function writeConfig(body: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), "fleetlens-kaihk-"));
    dirs.push(dir);
    const path = join(dir, "opencode.json");
    writeFileSync(path, JSON.stringify(body));
    return path;
  }

  it("finds OpenCode providers whose baseURL is api.kaihk.com", () => {
    const path = writeConfig({
      provider: {
        "kaihk-2": {
          name: "KaiHK 2",
          options: { baseURL: "https://api.kaihk.com/v1", apiKey: "sk-orbit-two" },
        },
        kaihk: {
          name: "KaiHK",
          options: { baseURL: "https://api.kaihk.com/v1", apiKey: "sk-orbit-one" },
        },
        other: {
          name: "Other",
          options: { baseURL: "https://api.example.com/v1", apiKey: "sk-nope" },
        },
      },
    });
    expect(discoverKaihkProviders(path).map((p) => p.id)).toEqual(["kaihk", "kaihk-2"]);
  });

  it("skips keys that are not sk- tokens", () => {
    const path = writeConfig({
      provider: {
        kaihk: {
          options: { baseURL: "https://api.kaihk.com/v1", apiKey: "not-a-key" },
        },
      },
    });
    expect(discoverKaihkProviders(path)).toEqual([]);
  });

  it("returns [] when the config is missing or unreadable", () => {
    expect(discoverKaihkProviders(join(tmpdir(), "no-such-opencode.json"))).toEqual([]);
  });
});

describe("parseKaihkSnapshot", () => {
  it("converts billing total_usage ($0.01 units) into monthly USD vs the plan cap", () => {
    const snap = parseKaihkSnapshot({
      agent: "kaihk",
      token: { data: { name: "orbit-shop", expires_at: 1_790_752_330, unlimited_quota: true } },
      billingUsage: { total_usage: 1832 },
      includedUsd: 50,
      capturedAt: "2026-08-30T12:00:00.000Z",
    });
    expect(snap.agent).toBe("kaihk");
    expect(snap.plan_type).toBe("orbit-shop");
    expect(snap.monthly).toEqual({
      utilization: 36.64,
      resets_at: new Date(1_790_752_330 * 1000).toISOString(),
    });
    expect(snap.monthly_quota).toEqual({
      used: 18.32,
      limit: 50,
      remaining: 31.68,
      unit: "usd",
      unlimited: false,
    });
    expect(snap.five_hour.utilization).toBeNull();
    expect(snap.seven_day.utilization).toBeNull();
  });

  it("falls back to token total_used / 500000 when billing usage is missing", () => {
    const snap = parseKaihkSnapshot({
      agent: "kaihk-2",
      token: { data: { total_used: 250_000 } },
      includedUsd: 50,
    });
    expect(snap.monthly_quota?.used).toBe(0.5);
    expect(snap.monthly?.utilization).toBe(1);
  });
});

describe("kaihk helpers", () => {
  const prev = process.env.KAIHK_PLAN_USD;
  afterEach(() => {
    if (prev === undefined) delete process.env.KAIHK_PLAN_USD;
    else process.env.KAIHK_PLAN_USD = prev;
  });

  it("titles extra OpenCode keys as KaiHK (N)", () => {
    expect(kaihkTitle("kaihk")).toBe("KaiHK");
    expect(kaihkTitle("kaihk-2")).toBe("KaiHK (2)");
    expect(isKaihkAgent("kaihk-3")).toBe(true);
    expect(isKaihkAgent("codex")).toBe(false);
  });

  it("keeps sub-cent spend instead of rounding to $0.00", () => {
    expect(formatKaihkUsd(18.32)).toBe("$18.32");
    expect(formatKaihkUsd(0.000958)).toBe("$0.000958");
    expect(formatKaihkUsd(50)).toBe("$50.00");
  });

  it("reads KAIHK_PLAN_USD and falls back to 50", () => {
    process.env.KAIHK_PLAN_USD = "80";
    expect(planUsd()).toBe(80);
    process.env.KAIHK_PLAN_USD = "nope";
    expect(planUsd()).toBe(50);
  });
});

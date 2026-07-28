import { describe, it, expect } from "vitest";
import {
  omitNulls,
  shortIso,
  usageCompactText,
  usageJsonPayload,
} from "../src/commands/usage.js";
import type { UsageSnapshot } from "../src/usage/api.js";

const empty = { utilization: null, resets_at: null };

function snap(agent: string, overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    captured_at: "2026-07-28T12:00:04.429Z",
    agent: agent as UsageSnapshot["agent"],
    five_hour: empty,
    seven_day: { utilization: 10, resets_at: null },
    seven_day_opus: null,
    seven_day_sonnet: null,
    seven_day_oauth_apps: null,
    seven_day_cowork: null,
    extra_usage: null,
    ...overrides,
  };
}

describe("usageJsonPayload", () => {
  it("returns agents in stable order with agent tags", () => {
    const payload = usageJsonPayload({
      grok: snap("grok"),
      codex: snap("codex", { seven_day: { utilization: 40, resets_at: null } }),
      "claude-code": snap("claude-code", { five_hour: { utilization: 2, resets_at: null } }),
    });
    expect(payload.agents.map((a) => a.agent)).toEqual([
      "claude-code",
      "codex",
      "grok",
    ]);
    expect(payload.agents[0]!.five_hour.utilization).toBe(2);
    expect(payload.agents[1]!.seven_day.utilization).toBe(40);
  });

  it("fills missing agent tags from the map key", () => {
    const legacy = snap("claude-code");
    delete (legacy as { agent?: string }).agent;
    const payload = usageJsonPayload({ "claude-code": legacy });
    expect(payload.agents).toHaveLength(1);
    expect(payload.agents[0]!.agent).toBe("claude-code");
  });

  it("returns an empty list when there is no data", () => {
    expect(usageJsonPayload({})).toEqual({ agents: [] });
  });
});

describe("omitNulls", () => {
  it("strips null fields deeply and drops empty objects", () => {
    expect(
      omitNulls({
        a: 1,
        b: null,
        c: { d: null, e: 2 },
        f: [1, null, { g: null, h: 3 }],
        five_hour: { utilization: null, resets_at: null },
      }),
    ).toEqual({ a: 1, c: { e: 2 }, f: [1, { h: 3 }] });
  });
});

describe("usageCompactText", () => {
  it("emits a TOON-like columnar table without null padding", () => {
    const text = usageCompactText({
      codex: snap("codex", {
        seven_day: { utilization: 40, resets_at: null },
        plan_type: "pro lite",
      }),
      "claude-code": snap("claude-code", {
        five_hour: { utilization: 2, resets_at: null },
        seven_day: { utilization: 20, resets_at: null },
      }),
    });
    expect(text).toBe(
      [
        "# % of plan quota used ↑busier | 5h/7d/mo windows | -=n/a",
        "agents[2]{agent,5h,7d,mo,plan,sampled}:",
        "claude,2,20,-,-,2026-07-28T12:00",
        "codex,-,40,-,pro_lite,2026-07-28T12:00",
        "",
      ].join("\n"),
    );
  });

  it("shortens ISO timestamps to minute precision", () => {
    expect(shortIso("2026-07-28T08:14:04.429Z")).toBe("2026-07-28T08:14");
  });
});

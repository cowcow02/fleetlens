import { describe, it, expect } from "vitest";
import { usageJsonPayload } from "../src/commands/usage.js";
import type { UsageSnapshot } from "../src/usage/api.js";

const empty = { utilization: null, resets_at: null };

function snap(agent: string, overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    captured_at: "2026-07-28T12:00:00.000Z",
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

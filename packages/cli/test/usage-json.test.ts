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
    expect(payload.legend).toMatch(/delta_pp/);
  });

  it("sorts extra Claude logins immediately after the default Claude row", () => {
    const payload = usageJsonPayload({
      grok: snap("grok"),
      "claude-code:work": snap("claude-code:work", { account: "work" }),
      "claude-code": snap("claude-code"),
    });
    expect(payload.agents.map((a) => a.agent)).toEqual([
      "claude-code",
      "claude-code:work",
      "grok",
    ]);
    expect(payload.agents[1]!.account).toBe("work");
  });

  it("fills missing agent tags from the map key", () => {
    const legacy = snap("claude-code");
    delete (legacy as { agent?: string }).agent;
    const payload = usageJsonPayload({ "claude-code": legacy });
    expect(payload.agents).toHaveLength(1);
    expect(payload.agents[0]!.agent).toBe("claude-code");
  });

  it("returns an empty list when there is no data", () => {
    const payload = usageJsonPayload({});
    expect(payload.agents).toEqual([]);
    expect(payload.legend).toMatch(/on_track/);
  });

  it("attaches 7d/30d pace and keeps Command Code monthly credits", () => {
    const now = Date.parse("2026-08-20T03:12:00Z");
    const payload = usageJsonPayload(
      {
        "command-code": snap("command-code", {
          plan_type: "GOAT",
          five_hour: { utilization: 2.8, resets_at: "2026-08-20T05:59:25Z" },
          seven_day: { utilization: 34.8, resets_at: "2026-08-24T03:09:15Z" },
          monthly: { utilization: 17.4, resets_at: "2026-09-17T03:06:55Z" },
          monthly_quota: {
            used: 12.17,
            limit: 70,
            remaining: 57.83,
            unit: "credits",
            unlimited: false,
          },
        }),
        copilot: snap("copilot", {
          seven_day: empty,
          monthly: { utilization: 0, resets_at: "2026-09-01T00:00:00Z" },
          monthly_quota: {
            used: 0,
            limit: 200,
            remaining: 200,
            unit: "ai-credits",
            unlimited: false,
          },
        }),
      },
      { nowMs: now },
    );
    const cmd = payload.agents.find((a) => a.agent === "command-code")!;
    expect(cmd.monthly?.utilization).toBe(17.4);
    expect(cmd.monthly_quota).toEqual({
      used: 12.17,
      limit: 70,
      remaining: 57.83,
      unit: "credits",
      unlimited: false,
    });
    expect(cmd.pace?.seven_day?.verdict).toBe("on_track");
    expect(cmd.pace?.monthly?.verdict).toBe("on_track");
    expect(cmd.pace?.monthly?.used_pct).toBe(17.4);

    const copilot = payload.agents.find((a) => a.agent === "copilot")!;
    expect(copilot.pace?.monthly?.verdict).toBe("slow");
    expect(copilot.pace?.seven_day).toBeUndefined();
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
        "# % of plan quota used ↑busier | 5h/7d/mo | 7d_pace/mo_pace=elapsed%-used% (+slow/-fast; |15|=on_track) | -=n/a",
        "agents[2]{agent,5h,7d,mo,7d_pace,mo_pace,plan,sampled}:",
        "claude,2,20,-,-,-,-,2026-07-28T12:00",
        "codex,-,40,-,-,-,pro_lite,2026-07-28T12:00",
        "",
      ].join("\n"),
    );
  });

  it("lists extra Claude logins as claude-<slug> after the default", () => {
    const text = usageCompactText({
      "claude-code:work": snap("claude-code:work", {
        account: "work",
        five_hour: { utilization: 86, resets_at: null },
        seven_day: { utilization: 17, resets_at: null },
      }),
      "claude-code": snap("claude-code", {
        five_hour: { utilization: 4, resets_at: null },
        seven_day: { utilization: 9, resets_at: null },
      }),
    });
    const lines = text.trimEnd().split("\n");
    expect(lines[1]).toBe("agents[2]{agent,5h,7d,mo,7d_pace,mo_pace,plan,sampled}:");
    expect(lines[2]).toBe("claude,4,9,-,-,-,-,2026-07-28T12:00");
    expect(lines[3]).toBe("claude-work,86,17,-,-,-,-,2026-07-28T12:00");
  });

  it("includes Command Code monthly credits and signed 7d/30d pace", () => {
    const now = Date.parse("2026-08-20T03:12:00Z");
    const text = usageCompactText(
      {
        "command-code": snap("command-code", {
          captured_at: "2026-08-20T03:12:06.331Z",
          plan_type: "GOAT",
          five_hour: { utilization: 2.768, resets_at: "2026-08-20T05:59:25Z" },
          seven_day: { utilization: 34.758, resets_at: "2026-08-24T03:09:15Z" },
          monthly: { utilization: 17.386, resets_at: "2026-09-17T03:06:55Z" },
        }),
      },
      { nowMs: now },
    );
    const lines = text.trimEnd().split("\n");
    expect(lines[1]).toBe("agents[1]{agent,5h,7d,mo,7d_pace,mo_pace,plan,sampled}:");
    expect(lines[2]).toMatch(/^cmd,2\.8,34\.8,17\.4,/);
    expect(lines[2]).toContain(",GOAT,2026-08-20T03:12");
    // 5h is not paced; 7d and monthly carry signed elapsed%-used%.
    const cells = lines[2]!.split(",");
    expect(cells[4]).toMatch(/^[+-]?\d+$/);
    expect(cells[5]).toMatch(/^[+-]?\d+$/);
  });

  it("shortens ISO timestamps to minute precision", () => {
    expect(shortIso("2026-07-28T08:14:04.429Z")).toBe("2026-07-28T08:14");
  });
});

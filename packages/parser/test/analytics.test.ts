import { describe, it, expect } from "vitest";
import {
  daysBetween,
  dailyActivity,
  computeParallelism,
  detectParallelRuns,
  highLevelMetrics,
  groupByProject,
  sessionAirTimeMs,
  canonicalProjectName,
  worktreeName,
  projectRepoName,
} from "../src/analytics.js";
import type { SessionMeta, SessionEvent } from "../src/types.js";

const mkMeta = (
  id: string,
  project: string,
  start: string,
  end: string,
  extras: Partial<SessionMeta> = {},
): SessionMeta => ({
  id,
  filePath: `/x/${id}.jsonl`,
  projectName: `/Users/me/Repo/${project}`,
  projectDir: `-Users-me-Repo-${project}`,
  sessionId: id,
  firstTimestamp: start,
  lastTimestamp: end,
  durationMs: Date.parse(end) - Date.parse(start),
  eventCount: 10,
  model: "claude-opus-4-6",
  cwd: `/Users/me/Repo/${project}`,
  totalUsage: { input: 100, output: 50, cacheRead: 1000, cacheWrite: 200 },
  status: "idle",
  toolCallCount: 5,
  turnCount: 3,
  ...extras,
});

describe("toLocalDay / daysBetween", () => {
  it("daysBetween returns inclusive range", () => {
    const range = daysBetween("2026-04-08", "2026-04-10");
    expect(range).toEqual(["2026-04-08", "2026-04-09", "2026-04-10"]);
  });

  it("daysBetween of a single day returns one entry", () => {
    expect(daysBetween("2026-04-10", "2026-04-10")).toEqual(["2026-04-10"]);
  });
});

describe("dailyActivity", () => {
  it("returns one bucket per day, including empty days in the middle", () => {
    const sessions = [
      mkMeta("a", "foo", "2026-04-08T10:00:00Z", "2026-04-08T11:00:00Z"),
      mkMeta("b", "foo", "2026-04-10T10:00:00Z", "2026-04-10T11:00:00Z"),
    ];
    const buckets = dailyActivity(sessions);
    expect(buckets.length).toBeGreaterThanOrEqual(3); // at least 04-08, 04-09, 04-10
    // Depending on TZ, the day bucket may be one off; just verify we have contiguous coverage.
    const emptyDayCount = buckets.filter((b) => b.sessions === 0).length;
    expect(emptyDayCount).toBeGreaterThanOrEqual(1);
  });

  it("sums tool calls and turns per day", () => {
    const day = "2026-04-10";
    const sessions = [
      mkMeta("a", "foo", `${day}T10:00:00Z`, `${day}T11:00:00Z`, {
        toolCallCount: 5,
        turnCount: 2,
      }),
      mkMeta("b", "foo", `${day}T12:00:00Z`, `${day}T13:00:00Z`, {
        toolCallCount: 3,
        turnCount: 1,
      }),
    ];
    const buckets = dailyActivity(sessions);
    // The sessions land in the same local day either as 04-10 or 04-09 depending on TZ
    const nonEmpty = buckets.filter((b) => b.sessions > 0);
    expect(nonEmpty).toHaveLength(1);
    expect(nonEmpty[0]!.toolCalls).toBe(8);
    expect(nonEmpty[0]!.turns).toBe(3);
  });

  it("attributes tokens/tools per day from dailyBreakdown across a cross-midnight session", () => {
    // 23:00 Jun 1 → 01:00 Jun 2 local; built from local Dates for TZ independence.
    const startMs = new Date(2026, 5, 1, 23, 0, 0, 0).getTime();
    const endMs = new Date(2026, 5, 2, 1, 0, 0, 0).getTime();
    const s = mkMeta("x", "foo", new Date(startMs).toISOString(), new Date(endMs).toISOString(), {
      activeSegments: [{ startMs, endMs }],
      toolCallCount: 12,
      turnCount: 4,
      totalUsage: { input: 60, output: 30, cacheRead: 600, cacheWrite: 90 },
      dailyBreakdown: [
        { day: "2026-06-01", toolCalls: 7, turns: 3, tokens: { input: 10, output: 5, cacheRead: 100, cacheWrite: 15 } },
        { day: "2026-06-02", toolCalls: 5, turns: 1, tokens: { input: 50, output: 25, cacheRead: 500, cacheWrite: 75 } },
      ],
    });
    const buckets = dailyActivity([s]);
    const b1 = buckets.find((b) => b.date === "2026-06-01")!;
    const b2 = buckets.find((b) => b.date === "2026-06-02")!;
    // Session counted on both days; usage attributed to the day it happened.
    expect(b1.sessions).toBe(1);
    expect(b2.sessions).toBe(1);
    expect(b1.toolCalls).toBe(7);
    expect(b2.toolCalls).toBe(5);
    expect(b2.tokens.input).toBe(50);
    expect(b2.tokens.cacheRead).toBe(500);
    // The continuation day has agent time AND real tokens — the reported bug.
    expect(b2.airTimeMs).toBeGreaterThan(0);
    expect(b2.tokens.input + b2.tokens.output + b2.tokens.cacheRead + b2.tokens.cacheWrite).toBe(650);
  });
});

describe("computeParallelism", () => {
  it("detects overlapping sessions", () => {
    const sessions = [
      mkMeta("a", "foo", "2026-04-10T10:00:00Z", "2026-04-10T11:00:00Z"),
      mkMeta("b", "foo", "2026-04-10T10:30:00Z", "2026-04-10T11:30:00Z"),
      mkMeta("c", "foo", "2026-04-10T10:45:00Z", "2026-04-10T11:15:00Z"),
    ];
    const points = computeParallelism(sessions);
    const peak = Math.max(...points.map((p) => p.active));
    expect(peak).toBe(3);
  });

  it("detectParallelRuns finds contiguous regions with ≥2 active", () => {
    const sessions = [
      mkMeta("a", "foo", "2026-04-10T10:00:00Z", "2026-04-10T11:00:00Z"),
      mkMeta("b", "foo", "2026-04-10T10:30:00Z", "2026-04-10T11:30:00Z"),
      // Non-overlapping session later
      mkMeta("c", "foo", "2026-04-10T15:00:00Z", "2026-04-10T16:00:00Z"),
    ];
    const runs = detectParallelRuns(sessions);
    expect(runs.length).toBe(1);
    expect(runs[0]!.peak).toBe(2);
  });
});

describe("highLevelMetrics", () => {
  it("sums counts across sessions", () => {
    const sessions = [
      mkMeta("a", "foo", "2026-04-10T10:00:00Z", "2026-04-10T11:00:00Z"),
      mkMeta("b", "foo", "2026-04-10T12:00:00Z", "2026-04-10T13:00:00Z"),
    ];
    const m = highLevelMetrics(sessions);
    expect(m.sessionCount).toBe(2);
    expect(m.totalToolCalls).toBe(10);
    expect(m.totalTurns).toBe(6);
    expect(m.avgTurnsPerSession).toBe(3);
    expect(m.totalTokens.input).toBe(200);
  });
});

describe("groupByProject", () => {
  it("groups sessions by repo name and computes per-project metrics", () => {
    const sessions = [
      mkMeta("a", "foo", "2026-04-10T10:00:00Z", "2026-04-10T11:00:00Z"),
      mkMeta("b", "foo", "2026-04-10T12:00:00Z", "2026-04-10T13:00:00Z"),
      mkMeta("c", "bar", "2026-04-10T14:00:00Z", "2026-04-10T15:00:00Z"),
    ];
    const groups = groupByProject(sessions);
    expect(groups).toHaveLength(2);
    const foo = groups.find((g) => g.projectDir === "foo")!;
    expect(foo.sessions).toHaveLength(2);
    expect(foo.metrics.sessionCount).toBe(2);
    expect(foo.worktreeCount).toBe(0);
  });

  it("rolls up git worktrees under their parent repo", () => {
    const sessions = [
      // Parent repo
      mkMeta("parent", "foo", "2026-04-10T10:00:00Z", "2026-04-10T11:00:00Z"),
      // Two worktrees of foo
      mkMeta("wt1", "foo", "2026-04-10T12:00:00Z", "2026-04-10T13:00:00Z", {
        projectName: "/Users/me/Repo/foo/.worktrees/kip-148",
        projectDir: "-Users-me-Repo-foo--worktrees-kip-148",
      }),
      mkMeta("wt2", "foo", "2026-04-10T14:00:00Z", "2026-04-10T15:00:00Z", {
        projectName: "/Users/me/Repo/foo/.worktrees/quality-wave",
        projectDir: "-Users-me-Repo-foo--worktrees-quality-wave",
      }),
      // Unrelated project
      mkMeta("bar", "bar", "2026-04-10T10:00:00Z", "2026-04-10T11:00:00Z"),
    ];
    const groups = groupByProject(sessions);
    expect(groups).toHaveLength(2);
    const foo = groups.find((g) => g.projectDir === "foo")!;
    expect(foo.sessions).toHaveLength(3);
    expect(foo.worktreeCount).toBe(2);
    expect(foo.rawProjectDirs).toContain("-Users-me-Repo-foo");
    expect(foo.rawProjectDirs).toContain("-Users-me-Repo-foo--worktrees-kip-148");
    expect(foo.rawProjectDirs).toContain(
      "-Users-me-Repo-foo--worktrees-quality-wave",
    );
  });
});

describe("sessionAirTimeMs", () => {
  it("sums event-to-event gaps under the idle threshold", () => {
    const events: SessionEvent[] = [
      {
        index: 0,
        role: "user",
        rawType: "user",
        preview: "",
        blocks: [],
        raw: {},
      },
      {
        index: 1,
        role: "agent",
        rawType: "assistant",
        preview: "",
        blocks: [],
        raw: {},
        gapMs: 2000,
      },
      {
        index: 2,
        role: "tool-call",
        rawType: "assistant",
        preview: "",
        blocks: [],
        raw: {},
        gapMs: 5000,
      },
      // Long gap — user stepped away; should be excluded
      {
        index: 3,
        role: "agent",
        rawType: "assistant",
        preview: "",
        blocks: [],
        raw: {},
        gapMs: 10 * 60 * 1000,
      },
    ];
    const air = sessionAirTimeMs(events, 3 * 60 * 1000);
    expect(air).toBe(7000); // 2000 + 5000
  });
});

describe("canonicalProjectName + worktreeName", () => {
  it("strips /.worktrees/<name>", () => {
    expect(
      canonicalProjectName("/Users/me/Repo/foo/.worktrees/feat-x"),
    ).toBe("/Users/me/Repo/foo");
    expect(worktreeName("/Users/me/Repo/foo/.worktrees/feat-x")).toBe("feat-x");
  });

  it("strips /.claude/worktrees/<name>", () => {
    expect(
      canonicalProjectName("/Users/me/Repo/foo/.claude/worktrees/loop"),
    ).toBe("/Users/me/Repo/foo");
  });

  it("collapses repeated slashes before matching", () => {
    // Anomalous //claude/worktrees/... — must normalize to /.claude/...
    expect(
      canonicalProjectName("/Users/me/Repo/foo//claude/worktrees/orchestrate/sub"),
    ).toBe("/Users/me/Repo/foo");
    // Plain extra slash with no worktree marker — collapse but don't strip more
    expect(canonicalProjectName("/Users//me/Repo/bar")).toBe(
      "/Users/me/Repo/bar",
    );
  });

  it("returns input unchanged when no worktree marker is present", () => {
    expect(canonicalProjectName("/Users/me/Repo/foo")).toBe("/Users/me/Repo/foo");
    expect(worktreeName("/Users/me/Repo/foo")).toBe(null);
  });

  it("folds Conductor workspaces under their repo", () => {
    expect(
      canonicalProjectName("/Users/me/conductor/workspaces/claude-lens/yangon"),
    ).toBe("/Users/me/conductor/workspaces/claude-lens");
    expect(worktreeName("/Users/me/conductor/workspaces/claude-lens/yangon")).toBe(
      "yangon",
    );
  });

  it("handles trailing slash on a Conductor workspace path", () => {
    expect(
      canonicalProjectName("/Users/me/conductor/workspaces/claude-lens/yangon/"),
    ).toBe("/Users/me/conductor/workspaces/claude-lens");
    expect(
      worktreeName("/Users/me/conductor/workspaces/claude-lens/yangon/"),
    ).toBe("yangon");
  });

  it("handles deeper paths inside a Conductor workspace", () => {
    expect(
      canonicalProjectName(
        "/Users/me/conductor/workspaces/claude-lens/yangon/packages/parser",
      ),
    ).toBe("/Users/me/conductor/workspaces/claude-lens");
  });

  it("collapses Superset worktrees, dropping the per-run uuid", () => {
    // ~/.superset/worktrees/<run-uuid>/<workspace> — the uuid is per-run noise,
    // so all runs of one workspace fold together with the workspace as badge.
    const p =
      "/Users/me/.superset/worktrees/b77ee62a-ff4f-46d4-9d92-981e54565d55/chart-input-blank-fix";
    expect(canonicalProjectName(p)).toBe(
      "/Users/me/.superset/worktrees/chart-input-blank-fix",
    );
    expect(worktreeName(p)).toBe("chart-input-blank-fix");
  });

  it("handles a Superset worktree with no uuid layer", () => {
    const p = "/Users/me/.superset/worktrees/agentic-knowledge-system";
    expect(canonicalProjectName(p)).toBe(p);
    expect(worktreeName(p)).toBe("agentic-knowledge-system");
  });

  it("projectRepoName folds the same repo across harnesses by repo name", () => {
    // Same repo reached directly, via a Conductor workspace, and via a
    // (now-deleted) Superset worktree all collapse to the repo name.
    expect(projectRepoName("/Users/me/Repo/claude-lens")).toBe("claude-lens");
    expect(projectRepoName("/Users/me/conductor/workspaces/claude-lens")).toBe("claude-lens");
    expect(projectRepoName("/Users/me/Repo/claude-lens/.worktrees/feat-x")).toBe("claude-lens");
    expect(projectRepoName("/Users/me/conductor/workspaces/claude-lens/yangon")).toBe("claude-lens");
  });

  it("handles repos whose name starts with the workspace name (offset bug regression)", () => {
    // Repo "yangon-api" + workspace "yangon": indexOf("/yangon") would
    // land inside "/yangon-api/" and produce a wrong canonical.
    expect(
      canonicalProjectName("/Users/me/conductor/workspaces/yangon-api/yangon"),
    ).toBe("/Users/me/conductor/workspaces/yangon-api");
    expect(
      worktreeName("/Users/me/conductor/workspaces/yangon-api/yangon"),
    ).toBe("yangon");
    // And vice-versa: workspace name that ends with the repo name.
    expect(
      canonicalProjectName("/Users/me/conductor/workspaces/api/api-server"),
    ).toBe("/Users/me/conductor/workspaces/api");
    expect(
      worktreeName("/Users/me/conductor/workspaces/api/api-server"),
    ).toBe("api-server");
  });
});

describe("groupByProject — Conductor workspaces", () => {
  it("rolls up parallel Conductor workspaces of one repo as worktrees", () => {
    const sessions = [
      mkMeta("a", "claude-lens", "2026-04-10T10:00:00Z", "2026-04-10T11:00:00Z", {
        projectName: "/Users/me/conductor/workspaces/claude-lens/yangon",
        projectDir: "-Users-me-conductor-workspaces-claude-lens-yangon",
      }),
      mkMeta("b", "claude-lens", "2026-04-10T12:00:00Z", "2026-04-10T13:00:00Z", {
        projectName: "/Users/me/conductor/workspaces/claude-lens/buffalo",
        projectDir: "-Users-me-conductor-workspaces-claude-lens-buffalo",
      }),
      mkMeta("c", "claude-lens", "2026-04-10T14:00:00Z", "2026-04-10T15:00:00Z", {
        projectName: "/Users/me/conductor/workspaces/claude-lens/cayenne",
        projectDir: "-Users-me-conductor-workspaces-claude-lens-cayenne",
      }),
    ];
    const groups = groupByProject(sessions);
    expect(groups).toHaveLength(1);
    const lens = groups[0]!;
    expect(lens.projectDir).toBe("claude-lens");
    expect(lens.sessions).toHaveLength(3);
    expect(lens.worktreeCount).toBe(3);
  });

  it("folds the same repo reached via different harnesses into one project", () => {
    const sessions = [
      mkMeta("direct", "claude-lens", "2026-04-10T10:00:00Z", "2026-04-10T11:00:00Z"),
      mkMeta("cond", "claude-lens", "2026-04-10T12:00:00Z", "2026-04-10T13:00:00Z", {
        projectName: "/Users/me/conductor/workspaces/claude-lens",
        projectDir: "-Users-me-conductor-workspaces-claude-lens",
      }),
      mkMeta("wt", "claude-lens", "2026-04-10T14:00:00Z", "2026-04-10T15:00:00Z", {
        projectName: "/Users/me/Repo/claude-lens/.worktrees/feat-x",
        projectDir: "-Users-me-Repo-claude-lens--worktrees-feat-x",
      }),
    ];
    const groups = groupByProject(sessions);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.projectDir).toBe("claude-lens");
    expect(groups[0]!.sessions).toHaveLength(3);
  });
});

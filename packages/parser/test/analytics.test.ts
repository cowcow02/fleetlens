import { describe, it, expect } from "vitest";
import {
  toLocalDay,
  daysBetween,
  dailyActivity,
  computeParallelism,
  detectParallelRuns,
  highLevelMetrics,
  groupByProject,
  sessionAirTimeMs,
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
    const byDate = Object.fromEntries(buckets.map((b) => [b.date, b]));
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
  it("groups sessions by projectDir and computes per-project metrics", () => {
    const sessions = [
      mkMeta("a", "foo", "2026-04-10T10:00:00Z", "2026-04-10T11:00:00Z"),
      mkMeta("b", "foo", "2026-04-10T12:00:00Z", "2026-04-10T13:00:00Z"),
      mkMeta("c", "bar", "2026-04-10T14:00:00Z", "2026-04-10T15:00:00Z"),
    ];
    const groups = groupByProject(sessions);
    expect(groups).toHaveLength(2);
    const foo = groups.find((g) => g.projectDir === "-Users-me-Repo-foo")!;
    expect(foo.sessions).toHaveLength(2);
    expect(foo.metrics.sessionCount).toBe(2);
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

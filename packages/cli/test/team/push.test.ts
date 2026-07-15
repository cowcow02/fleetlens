import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SessionMeta } from "@claude-lens/parser";
import type { Entry } from "@claude-lens/entries";
import { __setEntriesDirForTest, writeEntry } from "@claude-lens/entries/fs";
import {
  bucketToRollup,
  buildRollupsForRange,
  buildIngestPayload,
  buildRichRollupBlocks,
  buildEnrichedExtras,
  buildRichBlocksForDay,
  pushToTeamServer,
  readLatestUsageSnapshotForWire,
} from "../../src/team/push.js";
import type { TeamConfig } from "../../src/team/config.js";

function makeEntry(overrides: Partial<Entry> & Pick<Entry, "session_id" | "local_day" | "project">): Entry {
  return {
    version: 2,
    session_id: overrides.session_id,
    local_day: overrides.local_day,
    project: overrides.project,
    start_iso: `${overrides.local_day}T10:00:00.000Z`,
    end_iso: `${overrides.local_day}T11:00:00.000Z`,
    numbers: {
      active_min: 30, turn_count: 8, tools_total: 20, subagent_calls: 0,
      skill_calls: 0, task_ops: 0, interrupts: 0, tool_errors: 0,
      consec_same_tool_max: 2, exit_plan_calls: 0, prs: 0, commits: 0,
      pushes: 0, tokens_total: 0,
    },
    flags: [],
    primary_model: "claude-opus",
    model_mix: {},
    first_user: "",
    final_agent: "",
    pr_titles: [],
    top_tools: [],
    skills: {},
    subagents: [],
    satisfaction_signals: { happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0 },
    user_input_sources: { human: 1, teammate: 0, skill_load: 0, slash_command: 0 },
    enrichment: {
      status: "pending", generated_at: null, model: null, cost_usd: null,
      error: null, brief_summary: null, underlying_goal: null,
      friction_detail: null, user_instructions: [], outcome: null,
      claude_helpfulness: null, goal_categories: {}, retry_count: 0,
    },
    generated_at: new Date().toISOString(),
    source_jsonl: "/tmp/x.jsonl",
    source_checkpoint: { byte_offset: 0, last_event_ts: null },
    ...overrides,
  };
}

function makeSession(dayISO: string, overrides: Partial<SessionMeta> = {}): SessionMeta {
  const startMs = Date.parse(`${dayISO}T10:00:00.000Z`);
  return {
    id: `sess_${dayISO}`,
    filePath: `/tmp/${dayISO}.jsonl`,
    projectName: "/tmp/project",
    projectDir: "tmp-project",
    sessionId: `sess_${dayISO}`,
    eventCount: 10,
    totalUsage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5 },
    status: "idle",
    airTimeMs: 60_000,
    toolCallCount: 5,
    turnCount: 3,
    firstTimestamp: new Date(startMs).toISOString(),
    activeSegments: [{ startMs, endMs: startMs + 60_000 }],
    ...overrides,
  };
}

const CONFIG: TeamConfig = {
  serverUrl: "https://team.example.com",
  memberId: "mem_abc",
  bearerToken: "tok_secret",
  teamSlug: "acme",
  pairedAt: "2026-01-01T00:00:00.000Z",
};

describe("bucketToRollup", () => {
  it("maps airTimeMs → agentTimeMs and date → day", () => {
    const rollup = bucketToRollup({
      date: "2026-04-16",
      sessions: 3,
      toolCalls: 10,
      turns: 5,
      tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
      durationMs: 500,
      airTimeMs: 120_000,
      peakParallelism: 1,
    });
    expect(rollup).toEqual({
      day: "2026-04-16",
      agentTimeMs: 120_000,
      sessions: 3,
      toolCalls: 10,
      turns: 5,
      tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
    });
  });
});

describe("buildRollupsForRange", () => {
  it("returns empty array for no sessions", () => {
    expect(buildRollupsForRange([])).toEqual([]);
  });

  it("returns one rollup per local day the sessions touched", () => {
    const rollups = buildRollupsForRange([
      makeSession("2026-04-14"),
      makeSession("2026-04-16"),
    ]);
    const days = rollups.map((r) => r.day);
    expect(days).toContain("2026-04-14");
    expect(days).toContain("2026-04-16");
  });

  it("counts a multi-day session on every local day it touched (+1 per day)", () => {
    // A single session whose active segments span three local days.
    const day = "2026-04-14";
    const startMs = new Date(2026, 3, 14, 10, 0, 0, 0).getTime();
    const longSession = makeSession(day, {
      id: "long",
      firstTimestamp: new Date(startMs).toISOString(),
      activeSegments: [{ startMs, endMs: startMs + 2 * 24 * 3600 * 1000 + 3600_000 }], // ~Apr 14 → Apr 16
    });
    const rollups = buildRollupsForRange([longSession]);
    // One session-day per calendar day the agent worked.
    expect(rollups.find((r) => r.day === "2026-04-14")?.sessions).toBe(1);
    expect(rollups.find((r) => r.day === "2026-04-15")?.sessions).toBe(1);
    expect(rollups.find((r) => r.day === "2026-04-16")?.sessions).toBe(1);
    // uniqueSessions is start-day only, so SUM stays equal to the real unique
    // count (1) — the figure aggregate consumers use.
    expect(rollups.find((r) => r.day === "2026-04-14")?.uniqueSessions).toBe(1);
    expect(rollups.find((r) => r.day === "2026-04-15")?.uniqueSessions).toBe(0);
    expect(rollups.find((r) => r.day === "2026-04-16")?.uniqueSessions).toBe(0);
    expect(rollups.reduce((s, r) => s + (r.uniqueSessions ?? 0), 0)).toBe(1);
  });

  it("REGRESSION: a cross-midnight session's continuation day has real tokens/tools, not zeros", () => {
    // 23:30 Jun 1 → 02:30 Jun 2 local. dailyBreakdown attributes Jun-1 work to
    // Jun 1 and Jun-2 work to Jun 2 — so neither day is "agent time but 0 tokens".
    const startMs = new Date(2026, 5, 1, 23, 30, 0, 0).getTime();
    const endMs = new Date(2026, 5, 2, 2, 30, 0, 0).getTime();
    const cross = makeSession("2026-06-01", {
      id: "cross",
      firstTimestamp: new Date(startMs).toISOString(),
      activeSegments: [{ startMs, endMs }],
      totalUsage: { input: 6000, output: 3000, cacheRead: 80000, cacheWrite: 11000 },
      toolCallCount: 150,
      turnCount: 24,
      dailyBreakdown: [
        { day: "2026-06-01", toolCalls: 40, turns: 9, tokens: { input: 1000, output: 500, cacheRead: 20000, cacheWrite: 3000 } },
        { day: "2026-06-02", toolCalls: 110, turns: 15, tokens: { input: 5000, output: 2500, cacheRead: 60000, cacheWrite: 8000 } },
      ],
    });
    const rollups = buildRollupsForRange([cross]);
    const d1 = rollups.find((r) => r.day === "2026-06-01")!;
    const d2 = rollups.find((r) => r.day === "2026-06-02")!;
    const tok = (r: typeof d2) => r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheWrite;

    // The continuation day now carries its real share — the reported bug is gone.
    expect(d2.agentTimeMs).toBeGreaterThan(0);
    expect(d2.sessions).toBe(1);
    expect(d2.toolCalls).toBe(110);
    expect(d2.turns).toBe(15);
    expect(tok(d2)).toBe(75500);

    // Day 1 keeps its own share — nothing is lost or double-counted.
    expect(d1.toolCalls).toBe(40);
    expect(tok(d1)).toBe(24500);

    // Sum across days is exactly the session totals (sum-preserving split).
    expect(d1.toolCalls + d2.toolCalls).toBe(cross.toolCallCount);
    expect(tok(d1) + tok(d2)).toBe(
      cross.totalUsage.input + cross.totalUsage.output + cross.totalUsage.cacheRead + cross.totalUsage.cacheWrite,
    );
  });

  it("falls back to start-day attribution when a session has no dailyBreakdown", () => {
    // Sources without per-event data (codex/gemini) keep the prior behavior.
    const startMs = new Date(2026, 5, 1, 23, 30, 0, 0).getTime();
    const endMs = new Date(2026, 5, 2, 2, 30, 0, 0).getTime();
    const cross = makeSession("2026-06-01", {
      id: "nobreakdown",
      firstTimestamp: new Date(startMs).toISOString(),
      activeSegments: [{ startMs, endMs }],
      toolCallCount: 100,
      totalUsage: { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 },
      // dailyBreakdown intentionally omitted
    });
    const rollups = buildRollupsForRange([cross]);
    const d1 = rollups.find((r) => r.day === "2026-06-01")!;
    const d2 = rollups.find((r) => r.day === "2026-06-02")!;
    // Tokens/tools all land on the start day; both days still count the session.
    expect(d1.toolCalls).toBe(100);
    expect(d1.tokens.input).toBe(1000);
    expect(d2.toolCalls).toBe(0);
    expect(d1.sessions).toBe(1);
    expect(d2.sessions).toBe(1);
  });

  it("respects sinceDay filter", () => {
    const rollups = buildRollupsForRange(
      [makeSession("2026-04-14"), makeSession("2026-04-15"), makeSession("2026-04-16")],
      "2026-04-15",
    );
    const days = rollups.map((r) => r.day);
    expect(days).not.toContain("2026-04-14");
    expect(days).toContain("2026-04-15");
    expect(days).toContain("2026-04-16");
  });
});

describe("buildIngestPayload", () => {
  it("wraps rollup with UUID ingestId and ISO observedAt", () => {
    const rollup = bucketToRollup({
      date: "2026-04-16", sessions: 0, toolCalls: 0, turns: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      durationMs: 0, airTimeMs: 0, peakParallelism: 0,
    });
    const before = Date.now();
    const payload = buildIngestPayload({ rollup });
    const after = Date.now();

    expect(payload.dailyRollup).toEqual(rollup);
    expect(payload.ingestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const ts = Date.parse(payload.observedAt);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("generates a unique ingestId on each call", () => {
    const rollup = bucketToRollup({
      date: "2026-04-16", sessions: 0, toolCalls: 0, turns: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      durationMs: 0, airTimeMs: 0, peakParallelism: 0,
    });
    const a = buildIngestPayload({ rollup });
    const b = buildIngestPayload({ rollup });
    expect(a.ingestId).not.toBe(b.ingestId);
  });

  it("attaches usageSnapshot when provided", () => {
    const rollup = bucketToRollup({
      date: "2026-04-16", sessions: 0, toolCalls: 0, turns: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      durationMs: 0, airTimeMs: 0, peakParallelism: 0,
    });
    const snapshot = {
      capturedAt: "2026-04-16T10:00:00.000Z",
      fiveHour: { utilization: 5, resetsAt: "2026-04-16T14:00:00.000Z" },
      sevenDay: { utilization: 30, resetsAt: "2026-04-22T00:00:00.000Z" },
      sevenDayOpus: null,
      sevenDaySonnet: null,
      sevenDayOauthApps: null,
      sevenDayCowork: null,
      extraUsage: null,
    };
    const payload = buildIngestPayload({ rollup, usageSnapshot: snapshot });
    expect(payload.usageSnapshot).toEqual(snapshot);
  });

  it("omits usageSnapshot key when not provided", () => {
    const rollup = bucketToRollup({
      date: "2026-04-16", sessions: 0, toolCalls: 0, turns: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      durationMs: 0, airTimeMs: 0, peakParallelism: 0,
    });
    const payload = buildIngestPayload({ rollup });
    expect("usageSnapshot" in payload).toBe(false);
  });

  it("stamps the installed CLI version (esbuild define; '0.0.0-test' under vitest)", () => {
    const rollup = bucketToRollup({
      date: "2026-04-16", sessions: 0, toolCalls: 0, turns: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      durationMs: 0, airTimeMs: 0, peakParallelism: 0,
    });
    const payload = buildIngestPayload({ rollup });
    expect(payload.cliVersion).toBe("0.0.0-test");
  });
});

describe("readLatestUsageSnapshotForWire", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fleetlens-usage-test-"));
    path = join(dir, "usage.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function snapshotLine(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      captured_at: "2026-04-16T10:00:00.000Z",
      five_hour: { utilization: 23.7, resets_at: "2026-04-16T14:00:00.000Z" },
      seven_day: { utilization: 47.2, resets_at: "2026-04-22T00:00:00.000Z" },
      seven_day_opus: { utilization: 61, resets_at: "2026-04-22T00:00:00.000Z" },
      seven_day_sonnet: null,
      seven_day_oauth_apps: null,
      seven_day_cowork: null,
      extra_usage: null,
      ...overrides,
    });
  }

  it("returns null when file does not exist", () => {
    expect(readLatestUsageSnapshotForWire(join(dir, "nope.jsonl"))).toBeNull();
  });

  it("returns null when last entry is older than 10 minutes", () => {
    writeFileSync(path, snapshotLine() + "\n");
    const farFuture = Date.parse("2026-04-16T11:00:00.000Z"); // 1h after captured_at
    expect(readLatestUsageSnapshotForWire(path, farFuture)).toBeNull();
  });

  it("converts snake_case to camelCase wire format", () => {
    writeFileSync(path, snapshotLine() + "\n");
    const now = Date.parse("2026-04-16T10:05:00.000Z"); // within 10min
    const wire = readLatestUsageSnapshotForWire(path, now);
    expect(wire).toEqual({
      capturedAt: "2026-04-16T10:00:00.000Z",
      fiveHour: { utilization: 23.7, resetsAt: "2026-04-16T14:00:00.000Z" },
      sevenDay: { utilization: 47.2, resetsAt: "2026-04-22T00:00:00.000Z" },
      sevenDayOpus: { utilization: 61, resetsAt: "2026-04-22T00:00:00.000Z" },
      sevenDaySonnet: null,
      sevenDayOauthApps: null,
      sevenDayCowork: null,
      extraUsage: null,
    });
  });

  it("converts extra_usage block including dollar fields", () => {
    writeFileSync(
      path,
      snapshotLine({
        extra_usage: {
          is_enabled: true,
          monthly_limit: 50,
          used_credits: 12.5,
          utilization: 25,
        },
      }) + "\n",
    );
    const now = Date.parse("2026-04-16T10:05:00.000Z");
    const wire = readLatestUsageSnapshotForWire(path, now);
    expect(wire?.extraUsage).toEqual({
      isEnabled: true,
      monthlyLimitUsd: 50,
      usedCreditsUsd: 12.5,
      utilization: 25,
    });
  });

  it("returns the LAST line when multiple snapshots are present", () => {
    const lines = [
      snapshotLine({ captured_at: "2026-04-16T09:55:00.000Z", seven_day: { utilization: 10, resets_at: null } }),
      snapshotLine({ captured_at: "2026-04-16T10:00:00.000Z", seven_day: { utilization: 50, resets_at: null } }),
    ];
    writeFileSync(path, lines.join("\n") + "\n");
    const now = Date.parse("2026-04-16T10:05:00.000Z");
    expect(readLatestUsageSnapshotForWire(path, now)?.sevenDay.utilization).toBe(50);
  });
});

describe("pushToTeamServer", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls fetch with correct URL, headers, and body", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ received: true }),
    } as Response);

    const rollup = bucketToRollup({
      date: "2026-04-16", sessions: 0, toolCalls: 0, turns: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      durationMs: 0, airTimeMs: 0, peakParallelism: 0,
    });
    const payload = buildIngestPayload({ rollup });
    const result = await pushToTeamServer(CONFIG, payload);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://team.example.com/api/ingest/metrics");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer tok_secret",
    });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(payload);
    expect(result).toEqual({ ok: true, status: 200, body: { received: true } });
  });

  it("returns ok:false on server error", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized" }),
    } as Response);

    const rollup = bucketToRollup({
      date: "2026-04-16", sessions: 0, toolCalls: 0, turns: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      durationMs: 0, airTimeMs: 0, peakParallelism: 0,
    });
    const payload = buildIngestPayload({ rollup });
    const result = await pushToTeamServer(CONFIG, payload);
    expect(result).toEqual({ ok: false, status: 401, body: { error: "unauthorized" } });
  });
});

describe("buildRichRollupBlocks", () => {
  const day = "2026-05-12";
  const s1 = makeSession(day, {
    id: "s1", projectName: "/Users/x/Repo/fleetlens", projectDir: "users-x-Repo-fleetlens",
    activeSegments: [
      { startMs: Date.parse(`${day}T10:00:00.000Z`), endMs: Date.parse(`${day}T11:00:00.000Z`) },
    ],
  });
  const s2 = makeSession(day, {
    id: "s2", projectName: "/Users/x/Repo/fleetlens/.worktrees/feature",
    projectDir: "users-x-Repo-fleetlens---worktrees-feature",
    activeSegments: [
      { startMs: Date.parse(`${day}T10:30:00.000Z`), endMs: Date.parse(`${day}T12:00:00.000Z`) },
    ],
  });
  const s3 = makeSession(day, {
    id: "s3", projectName: "/Users/x/Repo/topeka", projectDir: "users-x-Repo-topeka",
    activeSegments: [
      { startMs: Date.parse(`${day}T14:00:00.000Z`), endMs: Date.parse(`${day}T15:00:00.000Z`) },
    ],
  });

  it("aggregates projects, working shapes, skills, subagents, flags, PRs", () => {
    const entries: Entry[] = [
      makeEntry({
        session_id: "s1", local_day: day, project: "/Users/x/Repo/fleetlens",
        numbers: { active_min: 60, turn_count: 10, tools_total: 30, subagent_calls: 1,
          skill_calls: 2, task_ops: 0, interrupts: 0, tool_errors: 3, consec_same_tool_max: 4,
          exit_plan_calls: 1, prs: 1, commits: 2, pushes: 1, tokens_total: 0 },
        flags: ["long_autonomous", "plan_used"],
        skills: { "brainstorming": 1, "writing-plans": 1 },
        subagents: [{ type: "reviewer", description: "", background: false, prompt_preview: "" }],
        signals: { working_shape: "solo-build", prompt_frames: [], subagent_roles: [],
          verbosity: "medium", external_refs: [], brainstorm_warmup: true, continuation_kind: "none" },
      }),
      makeEntry({
        session_id: "s2", local_day: day, project: "/Users/x/Repo/fleetlens",
        numbers: { active_min: 90, turn_count: 15, tools_total: 50, subagent_calls: 0,
          skill_calls: 0, task_ops: 0, interrupts: 0, tool_errors: 2, consec_same_tool_max: 0,
          exit_plan_calls: 0, prs: 1, commits: 3, pushes: 0, tokens_total: 0 },
        flags: ["long_autonomous"],
        signals: { working_shape: "reviewer-triad", prompt_frames: [], subagent_roles: [],
          verbosity: "long", external_refs: [], brainstorm_warmup: false, continuation_kind: "none" },
      }),
      makeEntry({
        session_id: "s3", local_day: day, project: "/Users/x/Repo/topeka",
        numbers: { active_min: 60, turn_count: 8, tools_total: 12, subagent_calls: 2,
          skill_calls: 0, task_ops: 1, interrupts: 0, tool_errors: 0, consec_same_tool_max: 0,
          exit_plan_calls: 0, prs: 0, commits: 1, pushes: 1, tokens_total: 0 },
        flags: [],
        subagents: [
          { type: "reviewer", description: "", background: false, prompt_preview: "" },
          { type: "general-purpose", description: "", background: true, prompt_preview: "" },
        ],
        signals: { working_shape: "solo-build", prompt_frames: [], subagent_roles: [],
          verbosity: "short", external_refs: [], brainstorm_warmup: false, continuation_kind: "none" },
      }),
    ];

    const blocks = buildRichRollupBlocks(day, [s1, s2, s3], entries);

    // Worktree rolled up into parent project (keyed by repo name).
    const fleetlens = blocks.projects.find((p) => p.project === "fleetlens");
    expect(fleetlens?.sessions).toBe(2);
    expect(fleetlens?.agentTimeMs).toBe(60 * 60_000 + 90 * 60_000);

    const topeka = blocks.projects.find((p) => p.project === "topeka");
    expect(topeka?.sessions).toBe(1);

    const solo = blocks.workingShapes.find((s) => s.shape === "solo-build");
    expect(solo?.sessions).toBe(2);
    const tri = blocks.workingShapes.find((s) => s.shape === "reviewer-triad");
    expect(tri?.sessions).toBe(1);

    expect(blocks.skillsLoaded.find((s) => s.name === "brainstorming")?.sessions).toBe(1);
    expect(blocks.subagentsDispatched.find((s) => s.type === "reviewer")?.count).toBe(2);
    expect(blocks.subagentsDispatched.find((s) => s.type === "general-purpose")?.count).toBe(1);

    expect(blocks.brainstormWarmupSessions).toBe(1);
    expect(blocks.planModeUsed).toBe(1);
    expect(blocks.toolErrors).toBe(5);
    expect(blocks.prs).toBe(2);
    expect(blocks.commits).toBe(6);
    expect(blocks.pushes).toBe(2);

    expect(blocks.longAutonomous.count).toBe(2);
    expect(blocks.longAutonomous.totalMin).toBe(150);
    expect(blocks.longAutonomous.maxSingleMin).toBe(90);

    // Concurrency: s1 + s2 overlap on (10:30-11:00) — at least one parallel
    // interval is detected.
    expect(blocks.concurrencyPeak).toBeGreaterThanOrEqual(2);
    expect(blocks.parallelMinutes).toBeGreaterThan(0);
  });

  it("skips project rows for synthetic non-path identities (UUID / cowork:unspaced)", () => {
    const uuid = makeSession(day, {
      id: "s-uuid", projectName: "2ec7f3c9-280b-45f0-9d44-c066115b1888",
      projectDir: "2ec7f3c9-280b-45f0-9d44-c066115b1888", agent: "antigravity",
      activeSegments: [
        { startMs: Date.parse(`${day}T10:00:00.000Z`), endMs: Date.parse(`${day}T11:00:00.000Z`) },
      ],
    });
    const unspaced = makeSession(day, {
      id: "s-cowork", projectName: "cowork:unspaced", projectDir: "cowork-unspaced", agent: "cowork",
      activeSegments: [
        { startMs: Date.parse(`${day}T10:30:00.000Z`), endMs: Date.parse(`${day}T12:00:00.000Z`) },
      ],
    });

    const blocks = buildRichRollupBlocks(day, [s1, uuid, unspaced], []);

    expect(blocks.projects.map((p) => p.project)).toEqual(["fleetlens"]);
    // The skipped sessions still count toward the day's concurrency math.
    expect(blocks.concurrencyPeak).toBeGreaterThanOrEqual(2);
  });

  it("clips a cross-midnight session to each touched day", () => {
    const dayA = "2026-05-12";
    const dayB = "2026-05-13";
    // 23:00 local Day A → 01:00 local Day B = 60 min on each side.
    const startMs = new Date(2026, 4, 12, 23, 0, 0, 0).getTime();
    const endMs = new Date(2026, 4, 13, 1, 0, 0, 0).getTime();
    const cross: SessionMeta = {
      ...s1,
      id: "sx",
      projectName: "/Users/x/Repo/fleetlens",
      projectDir: "users-x-Repo-fleetlens",
      firstTimestamp: new Date(startMs).toISOString(),
      activeSegments: [{ startMs, endMs }],
    };
    const entries: Entry[] = [
      makeEntry({ session_id: "sx", local_day: dayA, project: "/Users/x/Repo/fleetlens" }),
      makeEntry({ session_id: "sx", local_day: dayB, project: "/Users/x/Repo/fleetlens" }),
    ];

    const a = buildRichRollupBlocks(dayA, [cross], entries);
    const b = buildRichRollupBlocks(dayB, [cross], entries);
    const aProj = a.projects.find((p) => p.project === "fleetlens");
    const bProj = b.projects.find((p) => p.project === "fleetlens");
    expect(aProj?.agentTimeMs).toBe(60 * 60_000);
    expect(bProj?.agentTimeMs).toBe(60 * 60_000);
    // Each side counts the session once because its clipped segments exist
    // on both days — matching `dailyActivity`'s per-day sessions field.
    expect(aProj?.sessions).toBe(1);
    expect(bProj?.sessions).toBe(1);
  });

  describe("repo resolution (resolveRepo)", () => {
    it("keys rows by the cwd's resolved repo and merges checkouts of the same repo", () => {
      const resolve = (dir: string) =>
        dir === "/Users/x/Repo/fleetlens" || dir === "/Users/x/Repo/topeka"
          ? "cowcow02/fleetlens"
          : null;
      const blocks = buildRichRollupBlocks(day, [s1, s2, s3], [], resolve);
      expect(blocks.projects).toHaveLength(1);
      expect(blocks.projects[0]).toMatchObject({
        sessions: 3,
        githubRepos: ["cowcow02/fleetlens"],
      });
    });

    it("keeps custom worktree sessions under the parser-resolved project key", () => {
      const custom = makeSession(day, {
        id: "custom-wt",
        projectName: "/Users/x/Repo/fleetlens",
        projectDir: "Users-x-scratch-feature-one",
        worktreeName: "feature-one",
        activeSegments: [
          { startMs: Date.parse(`${day}T12:00:00.000Z`), endMs: Date.parse(`${day}T12:30:00.000Z`) },
        ],
      });
      const blocks = buildRichRollupBlocks(day, [s1, custom], [], () => null);
      expect(blocks.projects).toHaveLength(1);
      expect(blocks.projects[0]).toMatchObject({
        project: "fleetlens",
        sessions: 2,
      });
    });

    it("falls back to the entry's edited-dir repos when the cwd isn't a repo", () => {
      const parent = makeSession(day, {
        id: "sp", projectName: "/Users/x/Repo", projectDir: "users-x-Repo",
        activeSegments: [
          { startMs: Date.parse(`${day}T10:00:00.000Z`), endMs: Date.parse(`${day}T11:00:00.000Z`) },
        ],
      });
      const entries: Entry[] = [
        makeEntry({
          session_id: "sp", local_day: day, project: "/Users/x/Repo",
          edited_dirs: ["/Users/x/Repo/web-app/src", "/Users/x/Repo/web-app/test"],
        }),
      ];
      const resolve = (dir: string) => (dir.startsWith("/Users/x/Repo/web-app") ? "acme/web-app" : null);
      const blocks = buildRichRollupBlocks(day, [parent], entries, resolve);
      expect(blocks.projects[0]).toMatchObject({ githubRepos: ["acme/web-app"] });
    });

    it("falls back to an unambiguous harvested repo when nothing resolves on disk", () => {
      // Deleted checkout: resolver finds nothing, but the transcript saw a push.
      const entries: Entry[] = [
        makeEntry({
          session_id: "s3", local_day: day, project: "/Users/x/Repo/topeka",
          github_repos: ["cowcow02/fleetlens"],
        }),
      ];
      const blocks = buildRichRollupBlocks(day, [s3], entries, () => null);
      expect(blocks.projects[0]).toMatchObject({ githubRepos: ["cowcow02/fleetlens"] });
    });

    it("leaves rows keyed by basename when nothing resolves at all", () => {
      const blocks = buildRichRollupBlocks(day, [s1, s3], [], () => null);
      expect(blocks.projects.map((p) => p.project).sort()).toEqual(["fleetlens", "topeka"]);
      expect(blocks.projects.every((p) => !p.githubRepos)).toBe(true);
    });
  });
});

describe("buildEnrichedExtras", () => {
  const day = "2026-05-12";
  it("rolls up done-status enrichment into outcome/helpfulness/goal mixes", () => {
    const entries: Entry[] = [
      makeEntry({
        session_id: "s1", local_day: day, project: "/Users/x/Repo/fleetlens",
        enrichment: {
          status: "done", generated_at: new Date().toISOString(), model: "x",
          cost_usd: 0, error: null, brief_summary: "", underlying_goal: null,
          friction_detail: null, user_instructions: [], outcome: "shipped",
          claude_helpfulness: "essential",
          goal_categories: { build: 60, plan: 30 } as Record<string, number>,
          retry_count: 0,
        },
      }),
      makeEntry({
        session_id: "s2", local_day: day, project: "/Users/x/Repo/fleetlens",
        enrichment: {
          status: "done", generated_at: new Date().toISOString(), model: "x",
          cost_usd: 0, error: null, brief_summary: "", underlying_goal: null,
          friction_detail: null, user_instructions: [], outcome: "partial",
          claude_helpfulness: "essential",
          goal_categories: { build: 40 } as Record<string, number>,
          retry_count: 0,
        },
      }),
      // Pending status — must be skipped.
      makeEntry({ session_id: "s3", local_day: day, project: "/Users/x/Repo/topeka" }),
    ];
    const extras = buildEnrichedExtras(entries);
    expect(extras.outcomeMix).toEqual({ shipped: 1, partial: 1 });
    expect(extras.helpfulnessMix).toEqual({ essential: 2 });
    expect(extras.goalMix).toEqual({ build: 100, plan: 30 });
  });
});

describe("buildRichBlocksForDay", () => {
  let entriesDir: string;
  beforeEach(() => {
    entriesDir = mkdtempSync(join(tmpdir(), "fleetlens-entries-"));
    __setEntriesDirForTest(entriesDir);
  });
  afterEach(() => {
    rmSync(entriesDir, { recursive: true, force: true });
  });

  it("returns undefined when no entries are cached for the day", () => {
    const day = "2026-05-12";
    const session = makeSession(day);
    expect(buildRichBlocksForDay(day, [session])).toBeUndefined();
  });

  it("reads cached entries from disk and always returns blocks + enriched", () => {
    const day = "2026-05-12";
    const entry = makeEntry({
      session_id: "s1", local_day: day, project: "/Users/x/Repo/fleetlens",
      enrichment: {
        status: "done", generated_at: new Date().toISOString(), model: "x",
        cost_usd: 0, error: null, brief_summary: "", underlying_goal: null,
        friction_detail: null, user_instructions: [], outcome: "shipped",
        claude_helpfulness: "helpful", goal_categories: {}, retry_count: 0,
      },
    });
    writeEntry(entry);
    const session = makeSession(day, { id: "s1", projectName: "/Users/x/Repo/fleetlens",
      projectDir: "users-x-Repo-fleetlens" });

    const out = buildRichBlocksForDay(day, [session]);
    expect(out).toBeTruthy();
    expect(out!.rich.projects[0]?.project).toBe("fleetlens");
    expect(out!.enriched?.outcomeMix).toEqual({ shipped: 1 });
  });
});

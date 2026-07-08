import { describe, it, expect, vi } from "vitest";
import type { SessionMeta } from "@claude-lens/parser";

// The excluded project's entry sits in the same day-wide cache; only the
// session-id filter keeps it out of the aggregates.
vi.mock("@claude-lens/entries/fs", () => ({
  listEntriesForDay: vi.fn(() => [
    {
      session_id: "sess-work",
      day: "2026-07-07",
      project: "/u/x/Repo/work",
      skills: { "skill-a": 1 },
      subagents: [],
      numbers: { tool_errors: 0, exit_plan_calls: 0, active_min: 0 },
      flags: [],
      enrichment: { status: "done", outcome: "shipped", goal_categories: {} },
    },
    {
      session_id: "sess-personal",
      day: "2026-07-07",
      project: "/u/x/Repo/personal",
      skills: { "skill-b": 1 },
      subagents: [],
      numbers: { tool_errors: 0, exit_plan_calls: 0, active_min: 0 },
      flags: [],
      enrichment: { status: "done", outcome: "abandoned", goal_categories: {} },
    },
  ]),
  entryExists: vi.fn(() => true),
  writeEntryPreservingEnrichment: vi.fn(),
}));

import { buildRichBlocksForDay } from "../../src/team/push.js";

const workSession = {
  id: "sess-work",
  projectName: "/u/x/Repo/work",
  agent: "claude-code",
  activeSegments: [
    { startMs: new Date(2026, 6, 7, 10, 0).getTime(), endMs: new Date(2026, 6, 7, 11, 0).getTime() },
  ],
} as unknown as SessionMeta;

describe("buildRichBlocksForDay entry filtering", () => {
  it("drops cached entries whose sessions were filtered out", () => {
    const blocks = buildRichBlocksForDay("2026-07-07", [workSession]);
    expect(blocks).toBeDefined();
    const skillNames = blocks!.rich.skillsLoaded.map((s) => s.name);
    expect(skillNames).toContain("skill-a");
    expect(skillNames).not.toContain("skill-b");
    expect(blocks!.enriched.outcomeMix).toEqual({ shipped: 1 });
  });
});

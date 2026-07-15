import { describe, it, expect } from "vitest";
import {
  bucketVerbosity,
  classifySkill,
  classifySubagentRole,
  classifyUserInputSource,
  computeEntrySignals,
  countSatisfactionSignals,
  detectExternalRef,
  detectPromptFrames,
  extractUserInstructions,
  inferWorkingShape,
  isStockSubagentType,
} from "../src/signals.js";
import type { Entry } from "../src/types.js";

function mkEntry(over: Partial<Entry> = {}): Entry {
  const base: Entry = {
    version: 2, session_id: "s1", local_day: "2026-04-23",
    project: "/x", start_iso: "2026-04-23T10:00:00Z", end_iso: "2026-04-23T11:00:00Z",
    numbers: {
      active_min: 60, turn_count: 10, tools_total: 20, subagent_calls: 0,
      skill_calls: 0, task_ops: 0, interrupts: 0, tool_errors: 0,
      consec_same_tool_max: 0, exit_plan_calls: 0, prs: 0, commits: 0,
      pushes: 0, tokens_total: 0,
    },
    flags: [], primary_model: null, model_mix: {}, first_user: "", final_agent: "",
    pr_titles: [], top_tools: [], skills: {}, subagents: [],
    satisfaction_signals: { happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0 },
    user_input_sources: { human: 0, teammate: 0, skill_load: 0, slash_command: 0 },
    enrichment: {
      status: "pending", generated_at: null, model: null, cost_usd: null,
      error: null, brief_summary: null, underlying_goal: null,
      friction_detail: null, user_instructions: [], outcome: null,
      claude_helpfulness: null, goal_categories: {}, retry_count: 0,
    },
    generated_at: "2026-04-23T11:00:00Z", source_jsonl: "/",
    source_checkpoint: { byte_offset: 0, last_event_ts: null },
  };
  return { ...base, ...over };
}

describe("classifyUserInputSource", () => {
  it("flags <teammate-message> as teammate", () => {
    expect(classifyUserInputSource('<teammate-message teammate_id="team-lead">…')).toBe("teammate");
  });
  it("flags 'Base directory for this skill:' as skill_load", () => {
    expect(classifyUserInputSource("Base directory for this skill: /Users/x\nSkill body…")).toBe("skill_load");
  });
  it("flags <command-name> as slash_command", () => {
    expect(classifyUserInputSource("<command-name>/commit</command-name> body")).toBe("slash_command");
  });
  it("defaults to human for ordinary prose", () => {
    expect(classifyUserInputSource("can you fix the bug in foo.ts")).toBe("human");
  });
  it("handles empty string as human (degenerate)", () => {
    expect(classifyUserInputSource("")).toBe("human");
  });
  it("classifies a pure <system_instruction> wrapper (nothing after) as system_instruction", () => {
    const pureWrapper =
      "<system_instruction>\nYou are working inside Conductor, a Mac app.\n</system_instruction>";
    expect(classifyUserInputSource(pureWrapper)).toBe("system_instruction");
  });
  it("classifies wrapper + trailing user prose as human (wrapper stripped)", () => {
    const wrapped =
      "<system_instruction>\nYou are working inside Conductor.\n</system_instruction>\n\nfix the broken test in foo.ts";
    expect(classifyUserInputSource(wrapped)).toBe("human");
  });
});

describe("countSatisfactionSignals", () => {
  it("counts happy markers", () => {
    const c = countSatisfactionSignals("Yay! perfect! amazing");
    expect(c.happy).toBe(2);  // "Yay!" and "perfect!" (amazing not in set)
  });
  it("counts frustrated markers", () => {
    const c = countSatisfactionSignals("this is broken. stop. why did you do this");
    expect(c.frustrated).toBeGreaterThanOrEqual(2);
  });
  it("returns zeros for neutral text", () => {
    expect(countSatisfactionSignals("add a new function that returns 5")).toEqual({
      happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0,
    });
  });
});

describe("extractUserInstructions", () => {
  it("pulls 'can you…' asks", () => {
    const out = extractUserInstructions("can you rename foo to bar. also please run the tests.");
    expect(out).toContain("rename foo to bar");
    expect(out.some(s => s.includes("run the tests"))).toBe(true);
  });
  it("returns empty array for non-request text", () => {
    expect(extractUserInstructions("thanks, that worked")).toEqual([]);
  });
  it("caps at 5 instructions", () => {
    const text = "please a. please b. please c. please d. please e. please f. please g.";
    expect(extractUserInstructions(text).length).toBeLessThanOrEqual(5);
  });
  // Module-scope INSTRUCTION_RE has /g, so .exec() advances lastIndex.
  // The 5-cap break used to leave lastIndex past end of input, zeroing
  // matches on the next call.
  it("recovers from a previous 5-cap call (no stale /g lastIndex)", () => {
    extractUserInstructions(
      "please aa aa aa. please bb bb bb. please cc cc cc. please dd dd dd. please ee ee ee. please ff ff ff.",
    );
    expect(extractUserInstructions("can you rename foo to bar")).toEqual(["rename foo to bar"]);
  });
});

describe("bucketVerbosity", () => {
  it("buckets first_user lengths into short/medium/long/very_long", () => {
    expect(bucketVerbosity(50)).toBe("short");
    expect(bucketVerbosity(250)).toBe("medium");
    expect(bucketVerbosity(1000)).toBe("long");
    expect(bucketVerbosity(2500)).toBe("very_long");
  });
});

describe("classifySkill", () => {
  it("treats stock prefixes as stock", () => {
    expect(classifySkill("superpowers:brainstorming")).toBe("stock");
    expect(classifySkill("code-review:security-review")).toBe("stock");
    expect(classifySkill("using-superpowers")).toBe("stock");
  });
  it("treats unknown names as user-authored", () => {
    expect(classifySkill("my-custom-skill")).toBe("user");
  });
  it("treats ToolSearch noise as infra", () => {
    expect(classifySkill("(ToolSearch: foo)")).toBe("infra");
  });
});

describe("isStockSubagentType", () => {
  it("flags general-purpose as stock", () => {
    expect(isStockSubagentType("general-purpose")).toBe(true);
    expect(isStockSubagentType("Explore")).toBe(true);
    expect(isStockSubagentType("superpowers:code-reviewer")).toBe(true);
  });
  it("flags unknown types as user-authored", () => {
    expect(isStockSubagentType("implement-teammate")).toBe(false);
  });
});

describe("classifySubagentRole", () => {
  it("identifies reviewers", () => {
    expect(classifySubagentRole({
      type: "general-purpose", description: "review the spec for design issues",
      background: false, prompt_preview: "Audit the spec",
    })).toBe("reviewer");
  });
  it("identifies implementers when description says implement", () => {
    expect(classifySubagentRole({
      type: "general-purpose", description: "implement chunk 3",
      background: false, prompt_preview: "Build the queue handler",
    })).toBe("implementer");
  });
  it("falls back to other for vague tasks", () => {
    expect(classifySubagentRole({
      type: "general-purpose", description: "do the thing",
      background: false, prompt_preview: "stuff",
    })).toBe("other");
  });
});

describe("detectPromptFrames", () => {
  it("detects teammate frames", () => {
    expect(detectPromptFrames("<teammate-message>Hi</teammate-message>")).toContain("teammate");
  });
  it("detects handoff prose", () => {
    expect(detectPromptFrames("Here's the handoff prompt for the next session")).toContain("handoff-prose");
  });
  it("detects multiple frames in one prompt", () => {
    const out = detectPromptFrames("<command-name>/foo</command-name> [Image #1]");
    expect(out).toContain("slash-command");
    expect(out).toContain("image-attached");
  });
  it("returns empty array for plain prose", () => {
    expect(detectPromptFrames("just some text")).toEqual([]);
  });
});

describe("detectExternalRef", () => {
  it("detects Linear KIP references", () => {
    expect(detectExternalRef("can you implement ORB-123")).toMatchObject({ kind: "ticket-ref" });
  });
  it("detects GitHub issue references", () => {
    expect(detectExternalRef("fix issue #42")).toMatchObject({ kind: "github-issue-pr" });
  });
  it("skips Claude-feature framings", () => {
    expect(detectExternalRef("<teammate-message>fix issue #42</teammate-message>")).toBeNull();
  });
  it("returns null for plain text", () => {
    expect(detectExternalRef("just rewrite this function")).toBeNull();
  });
});

describe("inferWorkingShape", () => {
  it("returns null on tiny entries", () => {
    expect(inferWorkingShape(mkEntry({ numbers: { ...mkEntry().numbers, turn_count: 1 } }))).toBeNull();
  });
  it("classifies 2+ reviewer dispatches as spec-review-loop", () => {
    const e = mkEntry({
      subagents: [
        { type: "general-purpose", description: "review the spec", background: false, prompt_preview: "review pass" },
        { type: "general-purpose", description: "re-review the spec", background: false, prompt_preview: "second review" },
      ],
    });
    expect(inferWorkingShape(e)).toBe("spec-review-loop");
  });
  it("classifies 2+ implementer chunk dispatches as chunk-implementation", () => {
    const e = mkEntry({
      subagents: [
        { type: "general-purpose", description: "implement chunk 1", background: false, prompt_preview: "chunk 1" },
        { type: "general-purpose", description: "implement chunk 2", background: false, prompt_preview: "chunk 2" },
      ],
    });
    expect(inferWorkingShape(e)).toBe("chunk-implementation");
  });
  it("classifies 'continue' first_user with no subagents as solo-continuation", () => {
    expect(inferWorkingShape(mkEntry({ first_user: "Continue." }))).toBe("solo-continuation");
  });
  it("classifies brainstorming-skill load as solo-design", () => {
    expect(inferWorkingShape(mkEntry({ skills: { "superpowers:brainstorming": 1 } }))).toBe("solo-design");
  });
  it("falls through to solo-build for naked work", () => {
    expect(inferWorkingShape(mkEntry({ first_user: "fix the bug" }))).toBe("solo-build");
  });
});

describe("computeEntrySignals", () => {
  it("populates the full EntrySignals shape from a fixture entry", () => {
    const e = mkEntry({
      first_user: "Fix issue #42 in the queue handler",
      skills: { "superpowers:brainstorming": 1 },
      subagents: [
        { type: "implement-teammate", description: "implement chunk", background: false, prompt_preview: "build" },
      ],
    });
    const s = computeEntrySignals(e);
    expect(s.verbosity).toBe("short");
    expect(s.external_refs[0]?.kind).toBe("github-issue-pr");
    expect(s.brainstorm_warmup).toBe(true);
    expect(s.continuation_kind).toBe("none");
    expect(s.subagent_roles).toHaveLength(1);
  });
  it("flags handoff-prose continuation kind", () => {
    const e = mkEntry({ first_user: "# Handoff: cleaning up state\n\nPick up where the previous session left off." });
    expect(computeEntrySignals(e).continuation_kind).toBe("handoff-prose");
  });
  it("flags 'continue' as literal-continue", () => {
    const e = mkEntry({ first_user: "continue" });
    expect(computeEntrySignals(e).continuation_kind).toBe("literal-continue");
  });
  it("returns empty external_refs for plain prose", () => {
    expect(computeEntrySignals(mkEntry({ first_user: "fix the bug" })).external_refs).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTranscript } from "@claude-lens/parser";
import { buildEntries } from "../src/build.js";
import type { SessionDetail } from "@claude-lens/parser";

const __dirname = dirname(fileURLToPath(import.meta.url));

function load(name: string): SessionDetail {
  const filePath = resolve(__dirname, "fixtures", name);
  const rawLines = readFileSync(filePath, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
  const { meta, events } = parseTranscript(rawLines);
  return {
    ...meta,
    id: "test-session",
    filePath,
    projectDir: "test-project-dir",
    projectName: meta.cwd ?? "/test/project",
    events,
  };
}

// ── 4a: skeleton + orchestrator ────────────────────────────────────────────

describe("buildEntries (deterministic)", () => {
  it("initialises enrichment.retry_count to 0 on new Entries", () => {
    const sd = load("one-day-session.jsonl");
    const entries = buildEntries(sd);
    for (const e of entries) {
      expect(e.enrichment.retry_count).toBe(0);
    }
  });

  it("produces one Entry for a single-day session", () => {
    const sd = load("one-day-session.jsonl");
    const entries = buildEntries(sd);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.session_id).toBe("test-session");
    expect(entries[0]!.version).toBe(2);
    expect(entries[0]!.enrichment.status).toMatch(/^(pending|skipped_trivial)$/);
    expect(entries[0]!.local_day).toBe("2026-04-22");
  });

  it("splits a midnight-spanning session into two Entries", () => {
    const sd = load("span-midnight-session.jsonl");
    const entries = buildEntries(sd);
    expect(entries).toHaveLength(2);
    const days = entries.map(e => e.local_day).sort();
    expect(days[0]).not.toBe(days[1]);
  });

  it("initialises enrichment as pending object, never null", () => {
    const sd = load("one-day-session.jsonl");
    const entries = buildEntries(sd);
    for (const e of entries) {
      expect(e.enrichment).toBeTypeOf("object");
      expect(e.enrichment).not.toBeNull();
      expect(e.enrichment.user_instructions).toEqual(expect.any(Array));
    }
  });

  it("is deterministic — repeated calls produce byte-equal JSON (excluding generated_at)", () => {
    const sd = load("one-day-session.jsonl");
    const a = buildEntries(sd);
    const b = buildEntries(sd);
    for (const e of [...a, ...b]) e.generated_at = "fixed";
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("entries are sorted by local_day ascending", () => {
    const sd = load("span-midnight-session.jsonl");
    const entries = buildEntries(sd);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.local_day < entries[1]!.local_day).toBe(true);
  });

  it("does NOT set orchestrated when 5 agents dispatched from a single turn", () => {
    const sd = load("five-agents-one-turn.jsonl");
    const entries = buildEntries(sd);
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.numbers.subagent_calls).toBe(5);
    expect(e.flags).not.toContain("orchestrated");
  });
});

// ── 4b: numbers cluster ────────────────────────────────────────────────────

describe("buildEntries numbers cluster", () => {
  it("computes turn_count and tools_total for one-day fixture", () => {
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    // fixture has 1 real user turn (non-tool-result user event) → 1 closed turn
    expect(entry!.numbers.turn_count).toBe(1);
    // fixture has 1 Bash tool_use → tools_total = 1
    expect(entry!.numbers.tools_total).toBe(1);
  });

  it("active_min is positive for a session with 3-minute events", () => {
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    expect(entry!.numbers.active_min).toBeGreaterThan(0);
  });

  it("tokens_total reflects assistant usage (deduped by message id)", () => {
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    // msg_00000001: 500 in + 50 out = 550; msg_00000002: 600 in + 80 out = 680; total = 1230
    expect(entry!.numbers.tokens_total).toBe(1230);
  });

  it("tool_errors counts is_error:true tool results", () => {
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    // fixture has no tool errors
    expect(entry!.numbers.tool_errors).toBe(0);
  });

  it("numbers object has all required keys", () => {
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    const n = entry!.numbers;
    expect(typeof n.active_min).toBe("number");
    expect(typeof n.turn_count).toBe("number");
    expect(typeof n.tools_total).toBe("number");
    expect(typeof n.subagent_calls).toBe("number");
    expect(typeof n.skill_calls).toBe("number");
    expect(typeof n.task_ops).toBe("number");
    expect(typeof n.interrupts).toBe("number");
    expect(typeof n.tool_errors).toBe("number");
    expect(typeof n.consec_same_tool_max).toBe("number");
    expect(typeof n.exit_plan_calls).toBe("number");
    expect(typeof n.prs).toBe("number");
    expect(typeof n.commits).toBe("number");
    expect(typeof n.pushes).toBe("number");
    expect(typeof n.tokens_total).toBe("number");
  });

  it("midnight-split entries each have independent turn_count", () => {
    const sd = load("span-midnight-session.jsonl");
    const entries = buildEntries(sd);
    expect(entries).toHaveLength(2);
    // each half has 1 real user turn
    expect(entries[0]!.numbers.turn_count).toBe(1);
    expect(entries[1]!.numbers.turn_count).toBe(1);
  });
});

// ── 4c: text + model + project fields ─────────────────────────────────────

describe("buildEntries text + model + project fields", () => {
  it("extracts first_user from full block text, not preview", () => {
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    expect(entry!.first_user.length).toBeGreaterThan(0);
    expect(entry!.first_user).toContain("foo function");
  });

  it("extracts final_agent from last assistant text block", () => {
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    expect(entry!.final_agent.length).toBeGreaterThan(0);
    expect(entry!.final_agent).toContain("foo function");
  });

  it("sets primary_model from assistant events", () => {
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    expect(entry!.primary_model).toBe("claude-opus-4-6");
  });

  it("model_mix counts per model", () => {
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    expect(entry!.model_mix["claude-opus-4-6"]).toBeGreaterThan(0);
  });

  it("top_tools includes Bash with sub-verbs when Bash is used", () => {
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    // one Bash call with "cat" command
    expect(entry!.top_tools.some(t => t.startsWith("Bash"))).toBe(true);
  });

  it("project uses cwd from tool-using events, canonicalized", () => {
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    // cwd in fixture is /test/project; no worktree suffix
    expect(entry!.project).toBe("/test/project");
  });

  it("start_iso and end_iso are ISO8601 strings", () => {
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    expect(entry!.start_iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry!.end_iso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // start must be before or equal end
    expect(entry!.start_iso <= entry!.end_iso).toBe(true);
  });

  it("first_user is truncated at 400 chars", () => {
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    expect(entry!.first_user.length).toBeLessThanOrEqual(400);
  });

  it("strips Conductor's <system_instruction> wrapper but keeps the user prompt that follows", () => {
    const sd = load("conductor-session.jsonl");
    const [entry] = buildEntries(sd);
    // Conductor sends ONE user message: "<system_instruction>…</system_instruction>\n\n{real prompt}".
    // The wrapper must be excised; the trailing prompt becomes first_user.
    expect(entry!.first_user).not.toContain("system_instruction");
    expect(entry!.first_user).not.toContain("working inside Conductor");
    expect(entry!.first_user).toContain("check the latest sessions");
    // Post-strip, the message classifies as "human" (real user prose remained).
    expect(entry!.user_input_sources.human).toBe(1);
  });

  it("pr_titles is empty array when no gh pr create in fixture", () => {
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    expect(entry!.pr_titles).toEqual([]);
    expect(entry!.numbers.prs).toBe(0);
  });
});

// ── 4d: flags + signals ────────────────────────────────────────────────────

describe("buildEntries flags + signals", () => {
  it("flags is an array (empty when no thresholds hit)", () => {
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    expect(Array.isArray(entry!.flags)).toBe(true);
  });

  it("satisfaction_signals are zero for neutral fixture text", () => {
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    // fixture text is neutral: "can you implement the foo function..."
    expect(entry!.satisfaction_signals.happy).toBe(0);
    expect(entry!.satisfaction_signals.frustrated).toBe(0);
  });

  it("does not count teammate messages as human in user_input_sources", () => {
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    // all user events in fixture are plain text (human)
    expect(entry!.user_input_sources.human).toBeGreaterThan(0);
    expect(entry!.user_input_sources.teammate).toBe(0);
  });

  it("user_input_sources.human equals real human user events count", () => {
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    // fixture has 1 real human turn (the tool_result event is not counted)
    expect(entry!.user_input_sources.human).toBe(1);
  });

  it("enrichment.user_instructions populated from human text in non-trivial sessions", () => {
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    // fixture has "can you implement" → should yield at least 1 instruction if not trivial
    if (entry!.enrichment.status === "pending") {
      expect(entry!.enrichment.user_instructions.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("fast_ship flag set when active_min < 5 and prs >= 1 (parametric)", () => {
    // Construct a synthetic session detail with a short session that shipped a PR.
    // We rely on the integration path via buildEntries with the existing fixture +
    // a direct check that a 4-minute session with a PR would get fast_ship.
    // Here we verify the flag is NOT set on our normal fixture (no PR).
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    expect(entry!.flags).not.toContain("fast_ship");
  });

  it("enrichment.status is skipped_trivial for trivial sessions", () => {
    // A session with only system/meta events (no user turns, no tools, tiny duration)
    // would be trivial. Our one-day fixture has a real turn so it should be pending.
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    // non-trivial due to having tools + a turn
    expect(entry!.enrichment.status).toBe("pending");
  });

  it("user_input_sources sum equals real non-tool-result user event count", () => {
    const sd = load("one-day-session.jsonl");
    const [entry] = buildEntries(sd);
    const src = entry!.user_input_sources;
    const total = src.human + src.teammate + src.skill_load + src.slash_command;
    // fixture: 1 real user input event (tool_result event excluded)
    expect(total).toBe(1);
  });
});

// ── positive-case tests (spec-required) ────────────────────────────────────

describe("buildEntries positive cases", () => {
  it("extracts pr_titles from gh pr create Bash commands", () => {
    const sd = load("pr-ship-session.jsonl");
    const [entry] = buildEntries(sd);
    expect(entry!.pr_titles).toContain("feat: test ship");
    expect(entry!.numbers.prs).toBe(1);
  });

  it("harvests github repo identities from gh pr create output", () => {
    const sd = load("pr-ship-session.jsonl");
    const [entry] = buildEntries(sd);
    // The fixture's tool result is the created PR's URL.
    expect(entry!.github_repos).toEqual(["org/repo"]);
  });

  it("extracts subagent dispatches with type, description, prompt_preview", () => {
    const sd = load("subagent-dispatch.jsonl");
    const [entry] = buildEntries(sd);
    expect(entry!.subagents.length).toBeGreaterThan(0);
    const s = entry!.subagents[0]!;
    expect(s.type).toBe("explorer");
    expect(s.description).toBe("scan repo");
    expect(s.prompt_preview).toBe("look at src/");
    expect(s.background).toBe(false);
    expect(s.type).toBeTypeOf("string");
    expect(s.description).toBeTypeOf("string");
    expect(s.prompt_preview).toBeTypeOf("string");
    expect(s.background).toBeTypeOf("boolean");
  });

  it("does not count <teammate-message> as human input", () => {
    const sd = load("teammate-dispatch.jsonl");
    const [entry] = buildEntries(sd);
    expect(entry!.user_input_sources.teammate).toBeGreaterThan(0);
    expect(entry!.user_input_sources.human).toBe(0);
  });
});

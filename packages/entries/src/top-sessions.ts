import { z } from "zod";
import type { ContentBlock } from "@claude-lens/parser";
import type {
  Entry, SessionPin, SessionPinKind, WeekTopSession, WorkingShape,
} from "./types.js";
import {
  classifySkill, inferWorkingShape, isStockSubagentType,
} from "./signals.js";
import type { CallLLM, EnrichUsage } from "./enrich.js";
import { runClaudeSubprocess, parseAndValidate } from "./llm-runner.js";

const IDLE_GAP_MS = 3 * 60 * 1000;
const LONG_AUTONOMOUS_MIN = 20;

const N_USER          = 150;
const N_FIRST_AGENT   = 150;
const N_LAST_AGENT    = 200;
const N_USER_TURN1    = 400;
const N_SUBAGENT      = 240;

function prettyProject(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function fmtMin(ms: number): number {
  return Math.round((ms / 1000 / 60) * 10) / 10;
}

function headTail(s: string, n: number): { chars: number; preview: string } | null {
  if (!s) return null;
  if (s.length <= 2 * n + 60) return { chars: s.length, preview: s };
  return {
    chars: s.length,
    preview: s.slice(0, n) + `\n[…truncated ${s.length - 2 * n} chars…]\n` + s.slice(-n),
  };
}

function activeMs(timestamps: number[]): number {
  const ts = [...timestamps].sort((a, b) => a - b);
  let active = 0;
  for (let i = 1; i < ts.length; i++) {
    const dt = ts[i]! - ts[i - 1]!;
    if (dt < IDLE_GAP_MS) active += dt;
  }
  return active;
}

const SHELL_NOISE = new Set(["sudo", "time", "nohup", "nice", "env", "exec"]);

function bashVerb(cmd: string): string {
  if (!cmd) return "?";
  let firstSeg = cmd.split(/\|\||&&|;|\|/, 1)[0]!.trim();
  if (firstSeg.startsWith("cd ")) {
    const parts = cmd.split(/&&|;/, 3);
    if (parts.length >= 2) firstSeg = parts[1]!.trim();
  }
  const tokens = firstSeg.split(/\s+/).filter(Boolean);
  while (tokens.length && SHELL_NOISE.has(tokens[0]!)) tokens.shift();
  if (!tokens.length) return "?";
  let first = tokens[0]!;
  if (first.includes("=") && !first.startsWith("/")) {
    tokens.shift();
    if (!tokens.length) return "?";
    first = tokens[0]!;
  }
  if (first.includes("/") && !first.startsWith("./")) {
    first = first.replace(/\/+$/, "").split("/").pop()!;
  }
  return first.replace(/^["']|["']$/g, "") || "?";
}

// ─── Picker ────────────────────────────────────────────────────────────

/** Pick up to 3 sessions worth a deep timeline view. Score by active time
 *  weighted up by subagent dispatches and PRs shipped. Filter to substantial
 *  entries (≥20 min active OR ≥1 PR OR ≥10 turns). Cap to 1 per project so
 *  the three slots showcase distinct work streams.
 *
 *  Multi-agent guarantee: when the week's entries span more than one source
 *  agent (Claude Code + Codex, etc.) the picks must show at least one
 *  non-claude-code session. The default scoring filter is calibrated for
 *  Claude Code's typical session length (≥20 min) and would silently
 *  exclude Codex's typically-shorter dispatches; the guarantee keeps the
 *  fleet view honest by reserving the last slot for the best non-Claude
 *  session when one exists with any meaningful activity. */
export function pickTopSessions(entriesByDay: Map<string, Entry[]>): Entry[] {
  const flat: Entry[] = [];
  for (const arr of entriesByDay.values()) flat.push(...arr);

  const scoreEntry = (e: Entry) =>
    e.numbers.active_min * (1 + 0.5 * e.numbers.subagent_calls + 5 * e.pr_titles.length);

  const scored = flat
    .filter(e => e.numbers.active_min >= 20 || e.numbers.turn_count >= 10 || e.pr_titles.length >= 1)
    .map(e => ({ entry: e, score: scoreEntry(e) }))
    .sort((a, b) => b.score - a.score);

  const seenProjects = new Set<string>();
  const picked: Entry[] = [];
  for (const { entry } of scored) {
    if (seenProjects.has(entry.project)) continue;
    seenProjects.add(entry.project);
    picked.push(entry);
    if (picked.length >= 3) break;
  }

  // Multi-agent guarantee: if the week has non-Claude entries but none made
  // the cut, swap the LOWEST-scoring pick for the BEST non-Claude entry.
  // We use a relaxed inclusion threshold here (≥3 min active OR ≥10 tools
  // OR ≥3 turns) so a meaningful Codex session counts even when shorter
  // than the Claude-tuned default. Same one-per-project rule still applies.
  const hasNonClaude = flat.some(e => (e.agent ?? "claude-code") !== "claude-code");
  const pickedHasNonClaude = picked.some(e => (e.agent ?? "claude-code") !== "claude-code");
  if (hasNonClaude && !pickedHasNonClaude) {
    const nonClaudeCandidates = flat
      .filter(e => (e.agent ?? "claude-code") !== "claude-code")
      .filter(e =>
        e.numbers.active_min >= 3 ||
        e.numbers.tools_total >= 10 ||
        e.numbers.turn_count >= 3,
      )
      .map(e => ({ entry: e, score: scoreEntry(e) + 0.0001 * e.numbers.tools_total }))
      .sort((a, b) => b.score - a.score);
    const reserved = nonClaudeCandidates.find(c => !seenProjects.has(c.entry.project));
    if (reserved) {
      // Drop the lowest-scoring Claude pick (or just append if we have <3)
      if (picked.length >= 3) picked.pop();
      picked.push(reserved.entry);
    }
  }
  return picked;
}

// ─── Slice (per-session payload from raw events) ───────────────────────

/** Subset of SessionDetail.events that this module reads — bucketing is
 *  driven by the typed `role`, not raw JSONL shape, so any adapter works. */
export type RawSessionEvent = {
  timestamp?: string;
  rawType: string;
  role?: string;
  blocks?: ContentBlock[];
  raw?: unknown;
};

type Turn = {
  events: RawSessionEvent[];
  user_text: string;
  agent_blocks: string[];
  tools_count: Map<string, number>;
  bash_verbs: Map<string, number>;
  skills: Map<string, number>;
  subagents: Array<{ type: string; description: string; prompt_preview: string; background: boolean }>;
  exit_plan_calls: number;
  todo_ops: number;
  interrupts: number;
  pr_created: string | null;
  timestamps: number[];
};

const INTERRUPT_RE = /\[request interrupted|interrupted by user/i;
const PR_TITLE_RE = /--title\s+["']([^"']+)["']/;

/** Walk events, group into turns, aggregate per-turn signals. Filtered to
 *  events whose timestamp falls within [windowStartMs, windowEndMs]. */
export function eventsToTurns(
  events: RawSessionEvent[],
  windowStartMs: number,
  windowEndMs: number,
): { turns: Turn[]; sliceStartMs: number; sliceEndMs: number } {
  const filtered: Array<RawSessionEvent & { _ts: number }> = [];
  for (const ev of events) {
    if (!ev.timestamp) continue;
    const ts = Date.parse(ev.timestamp);
    if (Number.isNaN(ts)) continue;
    if (ts < windowStartMs || ts > windowEndMs) continue;
    filtered.push({ ...ev, _ts: ts });
  }
  if (filtered.length === 0) {
    return { turns: [], sliceStartMs: windowStartMs, sliceEndMs: windowEndMs };
  }
  filtered.sort((a, b) => a._ts - b._ts);
  const sliceStartMs = filtered[0]!._ts;
  const sliceEndMs = filtered[filtered.length - 1]!._ts;

  const turns: Turn[] = [];
  let cur: Turn | null = null;

  for (const ev of filtered) {
    const blocks: ContentBlock[] = ev.blocks ?? [];
    const isUserBucket = ev.role === "user" || ev.role === "tool-result";
    const isAssistantBucket =
      ev.role === "agent" || ev.role === "agent-thinking" || ev.role === "tool-call";
    if (isUserBucket) {
      const isToolOnly = blocks.length > 0 && blocks.every((c) => c.type === "tool_result");
      if (!isToolOnly) {
        const text = blocks
          .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
          .map((b) => b.text)
          .join(" ");
        const interrupted = INTERRUPT_RE.test(text);
        if (cur && interrupted) cur.interrupts += 1;
        if (cur) turns.push(cur);
        cur = {
          events: [ev], user_text: text, agent_blocks: [],
          tools_count: new Map(), bash_verbs: new Map(),
          skills: new Map(), subagents: [],
          exit_plan_calls: 0, todo_ops: 0, interrupts: 0,
          pr_created: null, timestamps: [ev._ts],
        };
      } else if (cur) {
        cur.events.push(ev);
        cur.timestamps.push(ev._ts);
      }
    } else if (isAssistantBucket) {
      if (!cur) continue;
      cur.events.push(ev);
      cur.timestamps.push(ev._ts);
      for (const c of blocks) {
        if (!c || typeof c !== "object") continue;
        const ct = c as { type?: string; text?: string; name?: string; input?: Record<string, unknown> };
        if (ct.type === "text" && ct.text) {
          cur.agent_blocks.push(ct.text);
        } else if (ct.type === "tool_use") {
          const name = ct.name ?? "unknown";
          cur.tools_count.set(name, (cur.tools_count.get(name) ?? 0) + 1);
          if (name === "Skill") {
            const sk = String(ct.input?.skill ?? "unknown");
            cur.skills.set(sk, (cur.skills.get(sk) ?? 0) + 1);
          } else if (name === "Agent") {
            const inp = ct.input ?? {};
            cur.subagents.push({
              type: String(inp.subagent_type ?? "general-purpose"),
              description: String(inp.description ?? "").slice(0, 80),
              prompt_preview: String(inp.prompt ?? "").slice(0, N_SUBAGENT),
              background: Boolean(inp.run_in_background),
            });
          } else if (name === "ExitPlanMode") {
            cur.exit_plan_calls += 1;
          } else if (name === "TodoWrite" || name === "TaskCreate" || name === "TaskUpdate") {
            cur.todo_ops += 1;
          } else if (name === "Bash") {
            const cmd = String(ct.input?.command ?? "");
            const v = bashVerb(cmd);
            cur.bash_verbs.set(v, (cur.bash_verbs.get(v) ?? 0) + 1);
            if (/\bgh\s+pr\s+create\b/.test(cmd)) {
              const m = cmd.match(PR_TITLE_RE);
              cur.pr_created = m?.[1] ?? cmd.slice(0, 120);
            }
          }
        }
      }
    }
  }
  if (cur) turns.push(cur);
  return { turns, sliceStartMs, sliceEndMs };
}

// ─── Slice payload structure (LLM input) ───────────────────────────────

export type SliceTurn = {
  turn: number;
  start_min: number;
  end_min: number;
  wall_min: number;
  active_min: number;
  idle_before_min: number;
  start_iso: string;
  user: { chars: number; preview: string } | null;
  first_agent?: { chars: number; preview: string } | null;
  last_agent?: { chars: number; preview: string } | null;
  agent?: { chars: number; preview: string } | null;
  tools: string[];
  skills_loaded?: string[];
  subagents_dispatched?: Array<{ type: string; description: string; prompt_preview: string }>;
  exit_plan_calls?: number;
  todo_ops?: number;
  interrupts?: number;
  pr_created?: string;
  long_autonomous_run?: boolean;
};

export type CandidatePin = {
  start_min: number;
  end_min?: number;
  kind: SessionPinKind;
  context: Record<string, unknown>;
};

export type SessionSlice = {
  session_id: string;
  date: string;
  project: string;
  project_display: string;
  start_iso: string;
  wall_min: number;
  active_min: number;
  idle_min: number;
  turn_count: number;
  outcome: string | null;
  shipped_prs: string[];
  working_shape: NonNullable<WorkingShape> | null;
  day_signature: string | null;
  user_authored_skills: string[];
  user_authored_subagents: Array<{ type: string; count: number }>;
  stock_skills: string[];
  top_tools: string[];
  steering: WeekTopSession["steering"];
  active_intervals: Array<{ start_min: number; end_min: number }>;
  turns: SliceTurn[];
  candidate_pins: CandidatePin[];
};

/** Build the slice payload from an Entry + raw session events + day_signature. */
export function buildSessionSlice(
  entry: Entry,
  events: RawSessionEvent[],
  daySignature: string | null,
): SessionSlice {
  // Bound the window to entry's local-day footprint.
  const windowStart = Date.parse(entry.start_iso);
  const windowEnd = Date.parse(entry.end_iso);
  const { turns, sliceStartMs, sliceEndMs } = eventsToTurns(events, windowStart, windowEnd);

  const allTs = turns.flatMap(t => t.timestamps);
  const sessionWallMs = sliceEndMs - sliceStartMs;
  const sessionActiveMs = activeMs(allTs);

  // Active intervals (gap-filtered)
  const sortedTs = [...allTs].sort((a, b) => a - b);
  const intervals: Array<{ start_min: number; end_min: number }> = [];
  if (sortedTs.length > 0) {
    let intStart = sortedTs[0]!;
    let intEnd = sortedTs[0]!;
    for (let i = 1; i < sortedTs.length; i++) {
      const dt = sortedTs[i]! - intEnd;
      if (dt >= IDLE_GAP_MS) {
        intervals.push({
          start_min: fmtMin(intStart - sliceStartMs),
          end_min: fmtMin(intEnd - sliceStartMs),
        });
        intStart = sortedTs[i]!;
      }
      intEnd = sortedTs[i]!;
    }
    intervals.push({
      start_min: fmtMin(intStart - sliceStartMs),
      end_min: fmtMin(intEnd - sliceStartMs),
    });
  }

  // Per-turn payload
  const turnsOut: SliceTurn[] = [];
  let prevEndMs = sliceStartMs;
  const userMsgChars: number[] = [];
  let longUserMsgs = 0;

  turns.forEach((t, i) => {
    const turnStartMs = Math.min(...t.timestamps);
    const turnEndMs = Math.max(...t.timestamps);
    const turnWallMs = turnEndMs - turnStartMs;
    const turnActiveMs = activeMs(t.timestamps);
    const idleBeforeMs = i === 0 ? 0 : Math.max(0, turnStartMs - prevEndMs);
    prevEndMs = turnEndMs;

    if (t.user_text) {
      userMsgChars.push(t.user_text.length);
      if (t.user_text.length >= 800) longUserMsgs++;
    }

    let firstAgent: string | null = null;
    let lastAgent: string | null = null;
    if (t.agent_blocks.length > 0) {
      firstAgent = t.agent_blocks[0]!;
      lastAgent = t.agent_blocks.reduce((a, b) => b.length > a.length ? b : a);
    }
    const agentCollapse = (firstAgent !== null && firstAgent === lastAgent);

    const tools: string[] = [];
    const toolsArr = [...t.tools_count.entries()].sort((a, b) => b[1] - a[1]);
    for (const [name, n] of toolsArr) {
      if (name === "Bash" && t.bash_verbs.size > 0) {
        const top = [...t.bash_verbs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
          .map(([v, c]) => c > 1 ? `${v}×${c}` : v).join(", ");
        tools.push(`Bash×${n} (${top})`);
      } else {
        tools.push(n > 1 ? `${name}×${n}` : name);
      }
    }

    const N_USER_HERE = i === 0 ? N_USER_TURN1 : N_USER;

    const out: SliceTurn = {
      turn: i + 1,
      start_min: fmtMin(turnStartMs - sliceStartMs),
      end_min: fmtMin(turnEndMs - sliceStartMs),
      wall_min: fmtMin(turnWallMs),
      active_min: fmtMin(turnActiveMs),
      idle_before_min: fmtMin(idleBeforeMs),
      start_iso: new Date(turnStartMs).toISOString(),
      user: t.user_text ? headTail(t.user_text, N_USER_HERE) : null,
      tools,
    };
    if (agentCollapse) {
      out.agent = headTail(firstAgent!, Math.max(N_FIRST_AGENT, N_LAST_AGENT));
    } else {
      out.first_agent = firstAgent ? headTail(firstAgent, N_FIRST_AGENT) : null;
      out.last_agent = lastAgent ? headTail(lastAgent, N_LAST_AGENT) : null;
    }
    if (t.skills.size > 0) {
      out.skills_loaded = [...t.skills.entries()].map(([k, v]) => v > 1 ? `${k}×${v}` : k);
    }
    if (t.subagents.length > 0) {
      out.subagents_dispatched = t.subagents.map(sa => ({
        type: sa.type, description: sa.description, prompt_preview: sa.prompt_preview,
      }));
    }
    if (t.exit_plan_calls > 0) out.exit_plan_calls = t.exit_plan_calls;
    if (t.todo_ops > 0) out.todo_ops = t.todo_ops;
    if (t.interrupts > 0) out.interrupts = t.interrupts;
    if (t.pr_created) out.pr_created = t.pr_created;
    if (turnActiveMs >= LONG_AUTONOMOUS_MIN * 60 * 1000 && t.interrupts === 0) {
      out.long_autonomous_run = true;
    }
    turnsOut.push(out);
  });

  // Aggregate harness signature across turns
  const allSkills = new Map<string, number>();
  const userSubagents = new Map<string, number>();
  const allTools = new Map<string, number>();
  const allBashVerbs = new Map<string, number>();
  let totalInterrupts = 0;
  for (const t of turns) {
    for (const [k, v] of t.skills) allSkills.set(k, (allSkills.get(k) ?? 0) + v);
    for (const sa of t.subagents) {
      if (!isStockSubagentType(sa.type)) {
        userSubagents.set(sa.type, (userSubagents.get(sa.type) ?? 0) + 1);
      }
    }
    for (const [k, v] of t.tools_count) allTools.set(k, (allTools.get(k) ?? 0) + v);
    for (const [k, v] of t.bash_verbs) allBashVerbs.set(k, (allBashVerbs.get(k) ?? 0) + v);
    totalInterrupts += t.interrupts;
  }
  const userSkills: string[] = [];
  const stockSkills: string[] = [];
  for (const skill of allSkills.keys()) {
    const origin = classifySkill(skill);
    if (origin === "user") userSkills.push(skill);
    else if (origin === "stock") stockSkills.push(skill);
  }

  // Build top_tools — top 5 tools by use, with Bash sub-verbs
  const top_tools: string[] = [];
  const sortedTools = [...allTools.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  for (const [name, n] of sortedTools) {
    if (name === "Bash" && allBashVerbs.size > 0) {
      const top = [...allBashVerbs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([v, c]) => c > 1 ? `${v}×${c}` : v).join(", ");
      top_tools.push(`Bash×${n} (${top})`);
    } else {
      top_tools.push(`${name}×${n}`);
    }
  }

  userMsgChars.sort((a, b) => a - b);
  const median = userMsgChars.length === 0 ? 0
    : userMsgChars[Math.floor(userMsgChars.length / 2)]!;

  // Candidate pins
  const candidatePins: CandidatePin[] = [];
  for (const t of turnsOut) {
    if (t.user?.chars && t.user.chars >= 800) {
      candidatePins.push({
        start_min: t.start_min, kind: "user-steering",
        context: { chars: t.user.chars, turn: t.turn, format: t.user.chars >= 5000 ? "long-paste" : "long-prose" },
      });
    }
    if (t.subagents_dispatched && t.subagents_dispatched.length >= 3) {
      candidatePins.push({
        start_min: t.start_min, kind: "subagent-burst",
        context: { count: t.subagents_dispatched.length, types: t.subagents_dispatched.map(s => s.type), turn: t.turn },
      });
    }
    if (t.long_autonomous_run) {
      candidatePins.push({
        start_min: t.start_min, end_min: t.end_min, kind: "long-autonomous",
        context: { duration_min: t.active_min, turn: t.turn },
      });
    }
    if (t.exit_plan_calls && t.exit_plan_calls > 0) {
      candidatePins.push({ start_min: t.start_min, kind: "plan-mode", context: { turn: t.turn } });
    }
    if (t.pr_created) {
      candidatePins.push({ start_min: t.start_min, kind: "pr-ship", context: { pr_title: t.pr_created, turn: t.turn } });
    }
    if (t.skills_loaded && t.skills_loaded.length >= 2) {
      candidatePins.push({
        start_min: t.start_min, kind: "harness-chain",
        context: { skills: t.skills_loaded, turn: t.turn },
      });
    }
    if (t.interrupts && t.interrupts > 0) {
      candidatePins.push({
        start_min: t.start_min, kind: "interrupt",
        context: { count: t.interrupts, turn: t.turn },
      });
    }
  }

  return {
    session_id: entry.session_id,
    date: entry.local_day,
    project: entry.project,
    project_display: prettyProject(entry.project),
    start_iso: new Date(sliceStartMs).toISOString(),
    wall_min: fmtMin(sessionWallMs),
    active_min: fmtMin(sessionActiveMs),
    idle_min: fmtMin(sessionWallMs - sessionActiveMs),
    turn_count: turnsOut.length,
    outcome: entry.enrichment.outcome,
    shipped_prs: entry.pr_titles,
    working_shape: entry.signals?.working_shape ?? inferWorkingShape(entry),
    day_signature: daySignature,
    user_authored_skills: userSkills,
    user_authored_subagents: [...userSubagents.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count })),
    stock_skills: stockSkills,
    top_tools,
    steering: {
      user_msg_count: userMsgChars.length,
      long_user_msg_count: longUserMsgs,
      median_user_msg_chars: median,
      interrupts: totalInterrupts,
    },
    active_intervals: intervals,
    turns: turnsOut,
    candidate_pins: candidatePins,
  };
}

// ─── LLM prompt + response schema ──────────────────────────────────────

const PinResponseSchema = z.object({
  start_min: z.number(),
  end_min: z.number().optional(),
  kind: z.enum([
    "user-steering", "subagent-burst", "long-autonomous", "plan-mode",
    "pr-ship", "harness-chain", "interrupt", "brainstorm-loop", "agent-loop",
  ]),
  // Truncate rather than reject. The model anchors pin labels with detail
  // ("turn N, X-char message, Y subagents, version Z") and reaches 250-290
  // chars when the session has substance. A hard cap silently rejects the
  // entire top-session response (Zod is all-or-nothing per parse) and the
  // digest falls back to all-null narrative — happened on claude-lens
  // 2026-04-24 with one 286-char overflow killing 5 otherwise-valid pins.
  // 320 is the soft cap; anything over gets sliced at parse time.
  // Slice is surrogate-pair-safe: if the cut position would land in the
  // middle of a UTF-16 surrogate pair we back off one code unit so we
  // never emit an unpaired high surrogate (invalid UTF-16).
  label: z.string().min(1).transform(s => {
    if (s.length <= 320) return s;
    let cut = 317;
    const code = s.charCodeAt(cut - 1);
    if (code >= 0xD800 && code <= 0xDBFF) cut -= 1;
    return s.slice(0, cut) + "...";
  }),
});

export const TopSessionResponseSchema = z.object({
  why_picked: z.string().min(1).max(280),
  session_summary: z.string().min(1).max(400),
  what_worked: z.string().max(280).nullable(),
  what_hit_friction: z.string().max(280).nullable(),
  steering_summary: z.string().min(1).max(280),
  pins: z.array(PinResponseSchema).min(2).max(6),
}).passthrough();

export type TopSessionResponse = z.infer<typeof TopSessionResponseSchema>;

const SYSTEM_PROMPT = `You are writing the editorial perception layer for ONE session in a developer's weekly report. The reader sees a timeline minimap of this session with annotated pin markers; your job is to write a structured deep-dive that surfaces what made this session worth examining.

INPUT shape (transcript-style markdown, NOT JSON):
The user prompt is a markdown document with these sections:
  • Header lines: session id, project, date, started_at, wall/active/idle/turns, outcome, working shape, day signature, shipped PRs.
  • "## Harness" — bullets: user-authored skills, user-authored subagents, stock skills, top tools.
  • "## Steering" — single line: user message count, median chars, long-msg count, interrupt count.
  • "## Turns (N)" — one "### Turn K — start–end (wall, active, idle_before)" subsection per turn.
    Each turn has labeled lines:
      - "USER (Nc): <head-tail-truncated preview>"
      - "FIRST_AGENT / LAST_AGENT / AGENT (Nc): <head-tail-truncated preview>" (only one of these per turn)
      - "Tools: tool1, tool2, ..."
      - "Skills loaded this turn: ..."
      - "Subagent dispatched: <type> — <description>" with a "  prompt: <preview>" sub-line if present
      - "Signals: exit_plan×N · TodoWrite ops: M · interrupts: K · PR created: '...' · LONG-AUTONOMOUS RUN" (only when present)
  • "## Candidate pins" — bullet per candidate: "[start_min–end_min] kind — key=value, key=value". These are deterministic moments; pick + label the most editorial 3-5.

DURATION matters: a turn with active_min ≫ wall_min indicates the agent worked autonomously inside; idle_before_min indicates user-initiated gaps.

OUTPUT: ONE JSON object. Strict JSON, no prose outside, no fence.

{
  "why_picked": "1 sentence, ≤200 chars. WHY THIS SESSION matters in the week's context. Anchor in the most distinctive signals — PR count vs week total, longest autonomous span, unusual subagent dispatch count, dominant working_shape on a heavy day. Example: 'Picked because this 471-min session shipped 4 of the week's 22 PRs through a chunk-implementation pattern with 21 subagent dispatches.'",

  "session_summary": "1-2 sentences, second-person, ≤300 chars. WHAT HAPPENED — narrative arc tying the pins into a story. Anchor in the working_shape AND concrete turn observations. Example: 'You drove this 78-min session through a 1.5K-char handoff prompt, four parallel research subagents, and a 25-min autonomous build → ship cycle.'",

  "what_worked": "1 sentence, ≤200 chars. STRONGEST POSITIVE SIGNAL in this session. Tie to a specific moment — a successful subagent fan-out, a clean autonomous run that shipped, a quick error diagnosis, full trust extended. Example: 'The 25-min long-autonomous run shipped 7 chunks without interrupts — the upfront brainstorming load gave the agent enough scope to drive end-to-end.' Set null ONLY when the session was truly friction-dominated with no clear win.",

  "what_hit_friction": "1 sentence, ≤200 chars. MOST LOAD-BEARING FRICTION in this session. Tie to a specific moment — a long error paste, an interrupt cluster, a back-and-forth around a misunderstanding, a stalled subagent. Example: 'A 51K-char typecheck dump at minute 25 ate three turns of correction before the agent narrowed it down to one line.' Set null ONLY when the session was genuinely smooth (no interrupts, no error pastes, no mid-flight redirects).",

  "steering_summary": "1 sentence, ≤200 chars. HOW the user drove the agent. Reference: verbosity (long handoffs vs terse imperatives), framing (skill loads, slash commands), corrections (interrupts, mid-flight redirects), or trust (long-autonomous spans). Example: 'Heavy upfront briefing (3 messages ≥1K chars) then short steering — no interrupts, full trust through the 25-min build run.'",

  "pins": [
    { "start_min": <number>, "end_min": <number?>, "kind": "<one of: user-steering|subagent-burst|long-autonomous|plan-mode|pr-ship|harness-chain|interrupt|brainstorm-loop|agent-loop>", "label": "≤200 chars, second-person, editorial — explain WHAT happened and WHAT the user was doing, not just the rule label. Anchor with one or two specifics (turn number, char count, subagent count, PR title, version) but keep it tight" }
    // 3-5 items picked from candidate_pins (or composed from turns when a candidate is incomplete)
  ]
}

CRITICAL: each of why_picked / session_summary / what_worked / what_hit_friction is ONE sentence with a SPECIFIC observation — not generic ("this was a productive session"). They earn their space by adding something the reader couldn't infer from the timeline alone.

PIN-LABEL RULES (load-bearing):

1. Pick 3-5 candidates that tell the SESSION'S STORY. If two candidates fire on the same turn (e.g. user-steering + subagent-burst), emit ONE merged pin describing both. ("Steered with a 5K spec then immediately fanned out 4 research subagents.")
2. Labels are second-person editorial — describe what the user did, not what the system detected.
   - Bad: "user-steering kind, 1542 chars at turn 1"
   - Good: "Steered with a 1.5K-char handoff prompt — full scope set before any code touched"
3. Ground every label in the turn's actual content. Read the user/first_agent/last_agent text. Use the working_shape and harness signature to interpret.
4. For pr-ship pins, name the PR title (truncated if needed).
5. For long-autonomous spans, include the duration AND what was accomplished (read the turn's last_agent text for evidence).
6. For user-steering pins, distinguish formats:
   - format="long-paste" + agent diagnoses → "Pasted X-char error log; agent diagnosed in one turn"
   - format="long-prose" + skills loaded → "Loaded the brainstorming skill with a Y-char design ask"
   - format="long-prose" no skills → "Steered with a Y-char detailed brief"
7. For subagent-burst pins, characterize the role mix from descriptions (reviewers / researchers / implementers).
8. For harness-chain pins, name the actual chain in order: "writing-plans → executing-plans → simplify".
9. Conform to the ANCHORING RULE: every label must reference data visible in the input — turn number, message length, subagent count, skill name, PR title, duration. No floating prose.

VOCABULARY:
- "you" not "user"
- Working-shape names (spec-review-loop, chunk-implementation, etc.) are encouraged
- Internal flag tokens (loop_suspected, long_autonomous, fast_ship) — forbidden in labels
- "Plan Mode" specifically means /plan tool calls
- Avoid identity claims ("you're a Plan Mode person"). Stick to observed action.
`;

export const TOP_SESSION_SYSTEM_PROMPT = SYSTEM_PROMPT;

/**
 * Transcript-style top-session prompt. The bulky part is `turns[]` — each turn
 * has 10+ fields and there are typically 5-50 turns per session, so emitting
 * JSON pays the structural overhead repeatedly. Markdown-headed turns with
 * inline labeled metadata cut tokens roughly in half (and read better).
 *
 * The LLM still sees every field — just denser. The `evidence.quote`
 * substring check works against this prose just as it did against JSON.
 */
export function buildTopSessionUserPrompt(slice: SessionSlice): string {
  const lines: string[] = [];
  const out = (s = "") => lines.push(s);

  // ── Header ─────────────────────────────────────────────────────────────
  out(`# Session ${slice.session_id}`);
  out(`Project: ${slice.project_display} · Date: ${slice.date} · Started: ${slice.start_iso}`);
  out(`Wall: ${slice.wall_min}m · Active: ${slice.active_min}m · Idle: ${slice.idle_min}m · Turns: ${slice.turn_count}`);
  const meta: string[] = [];
  if (slice.outcome) meta.push(`Outcome: ${slice.outcome}`);
  if (slice.working_shape) meta.push(`Working shape: ${slice.working_shape}`);
  if (meta.length) out(meta.join(" · "));
  if (slice.day_signature) out(`Day signature: "${slice.day_signature}"`);
  if (slice.shipped_prs.length) {
    out(`Shipped PRs (${slice.shipped_prs.length}):`);
    for (const pr of slice.shipped_prs) out(`  - "${pr}"`);
  }

  // ── Harness ────────────────────────────────────────────────────────────
  out();
  out(`## Harness`);
  out(`- User-authored skills: ${slice.user_authored_skills.length ? slice.user_authored_skills.join(", ") : "(none)"}`);
  if (slice.user_authored_subagents.length) {
    const subs = slice.user_authored_subagents.map(s => `${s.type}×${s.count}`).join(", ");
    out(`- User-authored subagents: ${subs}`);
  }
  out(`- Stock skills loaded: ${slice.stock_skills.length ? slice.stock_skills.join(", ") : "(none)"}`);
  out(`- Top tools: ${slice.top_tools.length ? slice.top_tools.join(", ") : "(none)"}`);

  // ── Steering ───────────────────────────────────────────────────────────
  out();
  const st = slice.steering;
  out(`## Steering`);
  out(`${st.user_msg_count} user messages (median ${st.median_user_msg_chars} chars, ${st.long_user_msg_count} long, ${st.interrupts} interrupts)`);

  // ── Turns ──────────────────────────────────────────────────────────────
  out();
  out(`## Turns (${slice.turns.length})`);
  for (const t of slice.turns) {
    out();
    const idleNote = t.idle_before_min > 0 ? ` · ${t.idle_before_min}m idle before` : "";
    out(`### Turn ${t.turn} — ${t.start_min}m–${t.end_min}m (${t.wall_min}m wall, ${t.active_min}m active${idleNote})`);
    if (t.user) out(`USER (${t.user.chars}c): ${t.user.preview}`);

    // Emit each agent flavor that's present. Boundary turns can carry BOTH
    // first_agent and last_agent (head + tail of a long autonomous span);
    // middle turns carry just `agent`. The prior implementation collapsed
    // these via `??` and dropped LAST_AGENT whenever first_agent was set —
    // breaking the prompt's contract that says "use last_agent text as
    // evidence for what the autonomous span accomplished."
    if (t.first_agent) out(`FIRST_AGENT (${t.first_agent.chars}c): ${t.first_agent.preview}`);
    if (t.last_agent) out(`LAST_AGENT (${t.last_agent.chars}c): ${t.last_agent.preview}`);
    if (t.agent && !t.first_agent && !t.last_agent) {
      out(`AGENT (${t.agent.chars}c): ${t.agent.preview}`);
    }
    if (t.tools.length) out(`Tools: ${t.tools.join(", ")}`);
    if (t.skills_loaded?.length) out(`Skills loaded this turn: ${t.skills_loaded.join(", ")}`);
    if (t.subagents_dispatched?.length) {
      for (const sa of t.subagents_dispatched) {
        out(`Subagent dispatched: ${sa.type} — ${sa.description}`);
        if (sa.prompt_preview) out(`  prompt: ${sa.prompt_preview}`);
      }
    }
    const sigs: string[] = [];
    if (t.exit_plan_calls) sigs.push(`exit_plan×${t.exit_plan_calls}`);
    if (t.todo_ops) sigs.push(`TodoWrite ops: ${t.todo_ops}`);
    if (t.interrupts) sigs.push(`interrupts: ${t.interrupts}`);
    if (t.pr_created) sigs.push(`PR created: "${t.pr_created}"`);
    if (t.long_autonomous_run) sigs.push(`LONG-AUTONOMOUS RUN`);
    if (sigs.length) out(`Signals: ${sigs.join(" · ")}`);
  }

  // ── Candidate pins ─────────────────────────────────────────────────────
  out();
  out(`## Candidate pins (deterministic — pick + label the most editorial 3-6 of these for your "pins" output)`);
  if (slice.candidate_pins.length === 0) {
    out(`(none — sparse session)`);
  } else {
    for (const cp of slice.candidate_pins) {
      const range = cp.end_min !== undefined ? `${cp.start_min}m–${cp.end_min}m` : `${cp.start_min}m`;
      // Render context as a compact "key=value" line; keeps it readable while
      // preserving every numeric/string the model might want to anchor against.
      const ctxParts: string[] = [];
      for (const [k, v] of Object.entries(cp.context ?? {})) {
        if (v == null) continue;
        if (typeof v === "string") {
          ctxParts.push(`${k}="${v.length > 200 ? v.slice(0, 197) + "..." : v}"`);
        } else if (Array.isArray(v)) {
          ctxParts.push(`${k}=[${v.length} items]`);
        } else if (typeof v === "object") {
          ctxParts.push(`${k}={...}`);
        } else {
          ctxParts.push(`${k}=${v}`);
        }
      }
      out(`- [${range}] ${cp.kind}${ctxParts.length ? ` — ${ctxParts.join(", ")}` : ""}`);
    }
  }

  return lines.join("\n");
}

// ─── LLM generator ─────────────────────────────────────────────────────

export type GenerateTopSessionOptions = {
  model?: string;
  callLLM?: CallLLM;
  onProgress?: (info: { bytes: number; elapsedMs: number }) => void;
};

export type GenerateTopSessionResult = {
  topSession: WeekTopSession;
  usage: EnrichUsage | null;
};

const DEFAULT_MODEL = "sonnet";

const defaultCallLLMTopSession: CallLLM = (args) =>
  runClaudeSubprocess({ ...args, systemPrompt: TOP_SESSION_SYSTEM_PROMPT });

const validateTopSession = (content: string) =>
  parseAndValidate(content, TopSessionResponseSchema);

function sliceToBaseTopSession(slice: SessionSlice): WeekTopSession {
  return {
    session_id: slice.session_id,
    date: slice.date,
    project: slice.project,
    project_display: slice.project_display,
    start_iso: slice.start_iso,
    wall_min: slice.wall_min,
    active_min: slice.active_min,
    idle_min: slice.idle_min,
    turn_count: slice.turn_count,
    outcome: (slice.outcome as WeekTopSession["outcome"]) ?? null,
    shipped_prs: slice.shipped_prs,
    working_shape: slice.working_shape,
    day_signature: slice.day_signature,
    user_authored_skills: slice.user_authored_skills,
    user_authored_subagents: slice.user_authored_subagents,
    stock_skills: slice.stock_skills,
    top_tools: slice.top_tools,
    steering: slice.steering,
    timeline: {
      // duration_min is the minimap's x-axis scale. active_intervals carry
      // start/end_min as WALL-clock offsets from session start, so the scale
      // must be wall_min — not active_min — or intervals past the active
      // budget get clipped off the right edge (e.g. a long autonomous burst
      // that happens after a long idle gap appears past 100%, invisible).
      duration_min: slice.wall_min,
      active_intervals: slice.active_intervals,
    },
    session_summary: null,
    steering_summary: null,
    why_picked: null,
    what_worked: null,
    what_hit_friction: null,
    pins: [],
  };
}

/** Run the per-session LLM call. Returns a base WeekTopSession even on
 *  validation failure (with empty pins / null narrative) so the renderer
 *  can degrade gracefully. */
export async function generateTopSession(
  slice: SessionSlice,
  opts: GenerateTopSessionOptions = {},
): Promise<GenerateTopSessionResult> {
  const base = sliceToBaseTopSession(slice);
  // If there's nothing to talk about (no candidates), don't call the LLM —
  // the deterministic data renders fine without a story.
  if (slice.candidate_pins.length === 0) {
    return { topSession: base, usage: null };
  }

  const model = opts.model ?? DEFAULT_MODEL;
  const callLLM = opts.callLLM ?? defaultCallLLMTopSession;
  const userPrompt = buildTopSessionUserPrompt(slice);
  let inT = 0, outT = 0;
  let lastModel = model;

  function merge(value: TopSessionResponse): WeekTopSession {
    const pins: SessionPin[] = value.pins.map(p => ({
      start_min: p.start_min,
      end_min: p.end_min,
      kind: p.kind,
      label: p.label,
    }));
    return {
      ...base,
      session_summary: value.session_summary,
      steering_summary: value.steering_summary,
      why_picked: value.why_picked,
      what_worked: value.what_worked,
      what_hit_friction: value.what_hit_friction,
      pins,
    };
  }

  try {
    const r1 = await callLLM({ model, userPrompt, onProgress: opts.onProgress });
    inT += r1.input_tokens; outT += r1.output_tokens; lastModel = r1.model;
    const v1 = validateTopSession(r1.content);
    if (v1.ok) {
      const merged = merge(v1.value);
      // Surface cost via usage; caller persists separately.
      return { topSession: merged, usage: { input_tokens: inT, output_tokens: outT } };
    }

    const r2 = await callLLM({
      model, userPrompt,
      reminder: "Your previous response was not valid JSON or did not match the required schema. Return ONLY the JSON object with session_summary + steering_summary + pins (3-5 items, each with start_min/kind/label) — no prose, no code fence.",
      onProgress: opts.onProgress,
    });
    inT += r2.input_tokens; outT += r2.output_tokens; lastModel = r2.model;
    const v2 = validateTopSession(r2.content);
    if (v2.ok) {
      return { topSession: merge(v2.value), usage: { input_tokens: inT, output_tokens: outT } };
    }
    console.warn(`[top-session] ${slice.session_id}: LLM validation failed after retry (${v2.error})`);
    return { topSession: base, usage: { input_tokens: inT, output_tokens: outT } };
  } catch (err) {
    console.warn(`[top-session] ${slice.session_id}: LLM invocation failed (${(err as Error).message})`);
    return { topSession: base, usage: inT > 0 ? { input_tokens: inT, output_tokens: outT } : null };
  } finally {
    void lastModel;
  }
}

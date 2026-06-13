import type { ContentBlock, SessionDetail, SessionEvent } from "@claude-lens/parser";
import { toLocalDay, canonicalProjectName } from "@claude-lens/parser/analytics";

/** Reads typed SessionEvent fields rather than the raw JSONL line, so any
 *  adapter (Claude, Codex, …) feeds the rest of buildEntries unchanged. */
type EventView = {
  rawType: "user" | "assistant" | "summary" | "system";
  content: ContentBlock[];
  model?: string;
  msgId?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  cwd?: string;
};

function viewEvent(ev: SessionEvent): EventView {
  let rawType: EventView["rawType"];
  if (ev.role === "user" || ev.role === "tool-result") rawType = "user";
  else if (ev.role === "agent" || ev.role === "agent-thinking" || ev.role === "tool-call")
    rawType = "assistant";
  else if (ev.rawType === "summary") rawType = "summary";
  else rawType = "system";

  const rawCwd = (ev.raw as { cwd?: string } | undefined)?.cwd;

  return {
    rawType,
    content: ev.blocks ?? [],
    model: ev.model,
    msgId: ev.messageId,
    usage: ev.usage
      ? {
          input_tokens: ev.usage.input,
          output_tokens: ev.usage.output,
          cache_read_input_tokens: ev.usage.cacheRead,
          cache_creation_input_tokens: ev.usage.cacheWrite,
        }
      : undefined,
    cwd: rawCwd,
  };
}
import {
  type Entry,
  CURRENT_ENTRY_SCHEMA_VERSION,
  pendingEnrichment,
  skippedTrivialEnrichment,
} from "./types.js";
import {
  classifyUserInputSource,
  computeEntrySignals,
  countSatisfactionSignals,
  extractUserInstructions,
} from "./signals.js";
import { isTrivial } from "./trivial.js";

const IDLE_GAP_MS = 3 * 60 * 1000;
const INTERRUPT_RE = /\[request interrupted|interrupted by user/i;
const PR_TITLE_RE = /--title\s+["']([^"']+)["']/;
const BASH_CHAIN_SPLIT_RE = /\|\||&&|;|\|/;
const SHELL_NOISE = new Set(["sudo", "time", "nohup", "nice", "env", "exec"]);
const IMAGE_BLOCK_RE = /\[Image:\s*source:\s*[^\]]+\]/g;

// ── helpers ────────────────────────────────────────────────────────────────

function parseMs(iso?: string): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

function trunc(s: string | null | undefined, n: number): string {
  if (!s) return "";
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : one.slice(0, n - 1) + "…";
}

function minimizeImages(s: string): string {
  if (!s) return s;
  let counter = 0;
  return s.replace(IMAGE_BLOCK_RE, () => `[Image #${++counter}]`);
}

function bashVerb(cmd: string): string {
  if (!cmd) return "?";
  let firstSeg = cmd.split(BASH_CHAIN_SPLIT_RE, 1)[0]!.trim();
  if (firstSeg.startsWith("cd ") || firstSeg === "cd") {
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

function firstTextBlock(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  for (const b of blocks) {
    if (b && typeof b === "object" && (b as { type?: string }).type === "text") {
      return String((b as { text?: string }).text ?? "");
    }
  }
  return "";
}

/** Extract concatenated text from content blocks on a parsed event. */
function blockText(blocks: readonly unknown[] | undefined): string {
  if (!blocks) return "";
  return blocks
    .filter((b): b is { type: "text"; text: string } =>
      !!b && typeof b === "object" && (b as { type?: string }).type === "text"
        && typeof (b as { text?: unknown }).text === "string")
    .map(b => b.text)
    .join(" ");
}

// ── day grouping ───────────────────────────────────────────────────────────

function groupEventsByLocalDay(events: SessionEvent[]): Map<string, SessionEvent[]> {
  const byDay = new Map<string, SessionEvent[]>();
  for (const ev of events) {
    if (!ev.timestamp) continue;
    const ms = Date.parse(ev.timestamp);
    if (Number.isNaN(ms)) continue;
    const day = toLocalDay(ms);
    let bucket = byDay.get(day);
    if (!bucket) { bucket = []; byDay.set(day, bucket); }
    bucket.push(ev);
  }
  return byDay;
}

// ── turn-state machine (mirrors capsule.ts) ────────────────────────────────

type TurnState = {
  startMs?: number;
  lastMs?: number;
  eventTs: number[];
  userInput: string;
  firstAgentText?: string;
  lastAgentText?: string;
  toolsTotal: number;
  toolMix: Map<string, number>;
  bashVerbs: Map<string, number>;
  skills: Map<string, number>;
  subagents: Array<{
    type: string; description: string; background: boolean; prompt_preview: string;
  }>;
  taskOps: number;
  toolErrors: number;
  consecSameToolMax: number;
  consec: number;
  lastTool?: string;
  endedInInterrupt: boolean;
  models: Map<string, number>;
  tokensIn: number;
  tokensOut: number;
  tokensCacheR: number;
  tokensCacheW: number;
  seenMsgIds: Set<string>;
};

type ClosedTurn = {
  startMs: number;
  activeMs: number;
  userInput: string;
  firstAgentText?: string;
  lastAgentText?: string;
  toolsTotal: number;
  toolMix: Map<string, number>;
  bashVerbs: Map<string, number>;
  skills: Map<string, number>;
  subagents: Array<{ type: string; description: string; background: boolean; prompt_preview: string }>;
  taskOps: number;
  toolErrors: number;
  consecSameToolMax: number;
  endedInInterrupt: boolean;
  models: Map<string, number>;
  totalTokens: number;
  cwd?: string;
};

function newTurn(startMs?: number, userInput = ""): TurnState {
  return {
    startMs, lastMs: startMs,
    eventTs: startMs !== undefined ? [startMs] : [],
    userInput,
    toolsTotal: 0,
    toolMix: new Map(), bashVerbs: new Map(),
    skills: new Map(), subagents: [], taskOps: 0,
    toolErrors: 0, consecSameToolMax: 0, consec: 0,
    endedInInterrupt: false,
    models: new Map(),
    tokensIn: 0, tokensOut: 0, tokensCacheR: 0, tokensCacheW: 0,
    seenMsgIds: new Set(),
  };
}

function closeTurn(t: TurnState, closed: ClosedTurn[], cwd?: string): void {
  const ts = [...t.eventTs].sort((a, b) => a - b);
  let active = 0;
  for (let i = 1; i < ts.length; i++) {
    const dt = ts[i]! - ts[i - 1]!;
    if (dt < IDLE_GAP_MS) active += dt;
  }
  closed.push({
    startMs: t.startMs ?? 0,
    activeMs: active,
    userInput: t.userInput,
    firstAgentText: t.firstAgentText,
    lastAgentText: t.lastAgentText,
    toolsTotal: t.toolsTotal,
    toolMix: t.toolMix,
    bashVerbs: t.bashVerbs,
    skills: t.skills,
    subagents: t.subagents,
    taskOps: t.taskOps,
    toolErrors: t.toolErrors,
    consecSameToolMax: t.consecSameToolMax,
    endedInInterrupt: t.endedInInterrupt,
    models: t.models,
    totalTokens: t.tokensIn + t.tokensOut + t.tokensCacheR + t.tokensCacheW,
    cwd,
  });
}

// ── per-day aggregation ────────────────────────────────────────────────────

type DayAggregate = {
  closed: ClosedTurn[];
  firstUser?: string;
  finalAgent?: string;
  prTitles: string[];
  commits: number;
  pushes: number;
  githubRepos: string[];
  editedDirs: string[];
  modelTurns: Map<string, number>;
  totalToolErrors: number;
  totalInterrupts: number;
  exitPlanCalls: number;
  taskOpsTotal: number;
  cwdCounts: Map<string, number>;
  start_iso: string;
  end_iso: string;
  activeMs: number;
};

function aggregateDay(dayEvents: SessionEvent[], _sessionFallbackProject: string): DayAggregate {
  const prTitles: string[] = [];
  let commits = 0;
  let pushes = 0;
  // owner/name identities seen in the OUTPUT of git-push / gh-pr commands —
  // ground truth for which GitHub repo this day's work actually touched.
  const gitToolUseIds = new Set<string>();
  const githubRepos = new Set<string>();
  const editedDirCounts = new Map<string, number>();
  const modelTurns = new Map<string, number>();
  let totalToolErrors = 0;
  let totalInterrupts = 0;
  let exitPlanCalls = 0;
  let taskOpsTotal = 0;
  let firstUser: string | undefined;
  let finalAgent: string | undefined;
  const cwdCounts = new Map<string, number>();

  const closed: ClosedTurn[] = [];
  let cur: TurnState | undefined;
  const allTs: number[] = [];
  let lastEventCwd: string | undefined;

  for (const ev of dayEvents) {
    const tsMs = parseMs(ev.timestamp);
    if (tsMs !== undefined) allTs.push(tsMs);

    // Typed-event view replaces the old `ev.raw as Claude-shape` cast.
    // Adapters that produce typed SessionEvents (role/blocks/usage/...)
    // are agent-agnostic from here on — the synthesized Claude raw shape
    // is no longer required.
    const view = viewEvent(ev);
    const rawType = view.rawType;
    const msg = { content: view.content, id: view.msgId, model: view.model, usage: view.usage };
    const content: unknown = view.content;
    const eventCwd = view.cwd;
    if (eventCwd) lastEventCwd = eventCwd;

    if (rawType === "user") {
      const isToolResultOnly = Array.isArray(content) && content.length > 0
        && content.every((c: unknown) => c && typeof c === "object"
          && (c as { type?: string }).type === "tool_result");

      if (!isToolResultOnly) {
        const text = firstTextBlock(content) || (typeof content === "string" ? content : "");
        if (cur) {
          if (text && INTERRUPT_RE.test(text)) {
            cur.endedInInterrupt = true;
            totalInterrupts++;
          }
          closeTurn(cur, closed, eventCwd);
        }
        cur = newTurn(tsMs, text);
        if (!firstUser && text && classifyUserInputSource(text) === "human") {
          firstUser = text;
        }
      } else {
        // tool_result — count errors; harvest repo identities from git output
        if (Array.isArray(content)) {
          for (const c of content) {
            if (!c || typeof c !== "object" || (c as { type?: string }).type !== "tool_result") continue;
            if ((c as { is_error?: boolean }).is_error) {
              totalToolErrors++;
              if (cur) cur.toolErrors++;
            }
            const tuId = (c as { tool_use_id?: string }).tool_use_id;
            if (tuId && gitToolUseIds.has(tuId)) {
              const rc = (c as { content?: unknown }).content;
              const text = typeof rc === "string"
                ? rc
                : Array.isArray(rc)
                  ? rc.map((b) => (b && typeof b === "object" && typeof (b as { text?: string }).text === "string" ? (b as { text: string }).text : "")).join("\n")
                  : "";
              // Lookbehind rejects api.github.com / docs.github.com — their
              // path segments (repos/<owner>, rest/<topic>) parse as fake
              // owner/name pairs otherwise. user-attachments is GitHub's
              // image-CDN namespace, not a repo owner.
              for (const m of text.matchAll(/(?<![.\w])github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git\b|[/\s"'),]|$)/g)) {
                if (m[1]!.toLowerCase() === "user-attachments") continue;
                githubRepos.add(`${m[1]}/${m[2]}`.toLowerCase());
              }
            }
          }
        }
        if (cur && tsMs !== undefined) { cur.eventTs.push(tsMs); cur.lastMs = tsMs; }
      }
    } else if (rawType === "assistant") {
      if (cur && tsMs !== undefined) { cur.eventTs.push(tsMs); cur.lastMs = tsMs; }
      const model = msg.model;
      if (model) {
        modelTurns.set(model, (modelTurns.get(model) ?? 0) + 1);
        if (cur) cur.models.set(model, (cur.models.get(model) ?? 0) + 1);
      }
      const msgId = msg.id;
      const usage = msg.usage;
      if (cur && msgId && !cur.seenMsgIds.has(msgId) && usage) {
        cur.seenMsgIds.add(msgId);
        cur.tokensIn += usage.input_tokens ?? 0;
        cur.tokensOut += usage.output_tokens ?? 0;
        cur.tokensCacheR += usage.cache_read_input_tokens ?? 0;
        cur.tokensCacheW += usage.cache_creation_input_tokens ?? 0;
      }
      if (Array.isArray(content)) {
        for (const c of content) {
          if (!c || typeof c !== "object") continue;
          const ct = c as { type?: string; id?: string; text?: string; name?: string; input?: Record<string, unknown> };
          if (ct.type === "text" && ct.text) {
            finalAgent = ct.text;
            if (cur) {
              if (cur.firstAgentText === undefined) cur.firstAgentText = ct.text;
              cur.lastAgentText = ct.text;
            }
          } else if (ct.type === "tool_use") {
            const name = ct.name ?? "unknown";
            if (cur) {
              cur.toolsTotal++;
              cur.toolMix.set(name, (cur.toolMix.get(name) ?? 0) + 1);
              if (name === cur.lastTool) cur.consec++;
              else { cur.lastTool = name; cur.consec = 1; }
              if (cur.consec > cur.consecSameToolMax) cur.consecSameToolMax = cur.consec;
              if (name === "Skill") {
                const sk = String((ct.input?.skill as string | undefined) ?? "unknown");
                cur.skills.set(sk, (cur.skills.get(sk) ?? 0) + 1);
              }
              // ToolSearch is deferred-tool loading, not a skill — recording it
              // here drowned the real skills (~70% noise) in every skill widget
              // and inflated the maturity breadth axis. It stays counted in
              // toolMix as the tool it is.
              if (name === "Agent") {
                const inp = ct.input ?? {};
                cur.subagents.push({
                  type: String(inp.subagent_type ?? "general-purpose"),
                  description: trunc(String(inp.description ?? ""), 80),
                  prompt_preview: trunc(String(inp.prompt ?? ""), 240),
                  background: Boolean(inp.run_in_background),
                });
              }
              if (name === "ExitPlanMode") exitPlanCalls++;
              if (name === "TodoWrite" || name === "TaskCreate" || name === "TaskUpdate") {
                cur.taskOps++;
                taskOpsTotal++;
              }
            }
            if (name === "Bash") {
              const cmd = String((ct.input?.command as string | undefined) ?? "");
              if (cur) cur.bashVerbs.set(bashVerb(cmd), (cur.bashVerbs.get(bashVerb(cmd)) ?? 0) + 1);
              if (/\bgh\s+pr\s+create\b/.test(cmd)) {
                const m = cmd.match(PR_TITLE_RE);
                prTitles.push(m?.[1] ?? cmd.slice(0, 120));
              }
              if (/\bgit\s+commit\b/.test(cmd)) commits++;
              if (/\bgit\s+push\b/.test(cmd)) pushes++;
              if (ct.id && /\bgit\s+push\b|\bgh\s+pr\s+/.test(cmd)) gitToolUseIds.add(ct.id);
            }
            // Track cwd from tool-use-heavy tool names for project detection
            if (eventCwd && (name === "Bash" || name === "Edit" || name === "Write" || name === "Read")) {
              cwdCounts.set(eventCwd, (cwdCounts.get(eventCwd) ?? 0) + 1);
            }
            if (name === "Edit" || name === "Write" || name === "MultiEdit" || name === "NotebookEdit") {
              const fp = String((ct.input?.file_path ?? ct.input?.notebook_path ?? "") as string);
              const slash = fp.lastIndexOf("/");
              if (slash > 0) {
                const dir = fp.slice(0, slash);
                editedDirCounts.set(dir, (editedDirCounts.get(dir) ?? 0) + 1);
              }
            }
          }
        }
      }
    }
  }
  if (cur) closeTurn(cur, closed, lastEventCwd);

  // active_ms from all event timestamps (gap-filtered)
  const tsSorted = [...allTs].sort((a, b) => a - b);
  let activeMs = 0;
  for (let i = 1; i < tsSorted.length; i++) {
    const dt = tsSorted[i]! - tsSorted[i - 1]!;
    if (dt < IDLE_GAP_MS) activeMs += dt;
  }

  const tsSortedStrings = dayEvents
    .map(e => e.timestamp).filter((t): t is string => !!t).sort();
  const start_iso = tsSortedStrings[0] ?? "";
  const end_iso = tsSortedStrings[tsSortedStrings.length - 1] ?? "";

  return {
    closed,
    firstUser,
    finalAgent,
    prTitles,
    commits,
    pushes,
    githubRepos: [...githubRepos].slice(0, 5),
    editedDirs: [...editedDirCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([dir]) => dir),
    modelTurns,
    totalToolErrors,
    totalInterrupts,
    exitPlanCalls,
    taskOpsTotal,
    cwdCounts,
    start_iso,
    end_iso,
    activeMs,
  };
}

// ── top_tools builder ──────────────────────────────────────────────────────

function buildTopTools(closed: ClosedTurn[]): string[] {
  const toolMix = new Map<string, number>();
  const bashVerbsAll = new Map<string, number>();
  for (const t of closed) {
    for (const [k, v] of t.toolMix) toolMix.set(k, (toolMix.get(k) ?? 0) + v);
    for (const [k, v] of t.bashVerbs) bashVerbsAll.set(k, (bashVerbsAll.get(k) ?? 0) + v);
  }
  const top = [...toolMix.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return top.map(([name, count]) => {
    if (name === "Bash" && bashVerbsAll.size > 0) {
      const sub = [...bashVerbsAll.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([v, c]) => (c > 1 ? `${v}×${c}` : v)).join(", ");
      return `Bash×${count} (${sub})`;
    }
    return count > 1 ? `${name}×${count}` : name;
  });
}

// ── main export ────────────────────────────────────────────────────────────

export function buildEntries(sessionDetail: SessionDetail): Entry[] {
  const byDay = groupEventsByLocalDay(sessionDetail.events);
  const entries: Entry[] = [];
  const generatedAt = new Date().toISOString();
  const sessionFallbackProject = canonicalProjectName(sessionDetail.projectName ?? "");

  for (const [local_day, dayEvents] of byDay) {
    if (dayEvents.length === 0) continue;
    const agg = aggregateDay(dayEvents, sessionFallbackProject);
    const { closed } = agg;

    // numbers
    const turnCount = closed.length;
    const toolsTotal = closed.reduce((s, t) => s + t.toolsTotal, 0);
    const tokensTotal = closed.reduce((s, t) => s + t.totalTokens, 0);
    const subagentCalls = closed.reduce((s, t) => s + t.subagents.length, 0);
    const skillsMap = new Map<string, number>();
    for (const t of closed) {
      for (const [k, v] of t.skills) skillsMap.set(k, (skillsMap.get(k) ?? 0) + v);
    }
    const skillCalls = [...skillsMap.values()].reduce((a, b) => a + b, 0);
    const taskOps = agg.taskOpsTotal;
    const interrupts = agg.totalInterrupts;
    const toolErrors = agg.totalToolErrors;
    const consecMax = Math.max(0, ...closed.map(t => t.consecSameToolMax));
    const exitPlanCalls = agg.exitPlanCalls;
    const prs = agg.prTitles.length;
    const commits = agg.commits;
    const pushes = agg.pushes;
    const activeMin = Math.round(agg.activeMs / 6000) / 10;

    const numbers: Entry["numbers"] = {
      active_min: activeMin,
      turn_count: turnCount,
      tools_total: toolsTotal,
      subagent_calls: subagentCalls,
      skill_calls: skillCalls,
      task_ops: taskOps,
      interrupts,
      tool_errors: toolErrors,
      consec_same_tool_max: consecMax,
      exit_plan_calls: exitPlanCalls,
      prs,
      commits,
      pushes,
      tokens_total: tokensTotal,
    };

    // flags
    const longestTurnActiveMs = Math.max(0, ...closed.map(t => t.activeMs));
    const flags: string[] = [];
    if (interrupts >= 3) flags.push("interrupt_heavy");
    if (toolErrors >= 20) flags.push("high_errors");
    if (consecMax >= 8) flags.push("loop_suspected");
    if (agg.activeMs < 5 * 60_000 && prs >= 1) flags.push("fast_ship");
    if (exitPlanCalls > 0) flags.push("plan_used");
    const subagentTurns = closed.filter(t => t.subagents.length >= 1).length;
    if (subagentTurns >= 3) flags.push("orchestrated");
    if (longestTurnActiveMs >= 20 * 60_000 && interrupts === 0) flags.push("long_autonomous");

    // model
    const primaryModel = [...agg.modelTurns.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    const modelMix: Record<string, number> = Object.fromEntries(agg.modelTurns);

    // text fields
    const firstUserRaw = agg.firstUser ?? "";
    const first_user = trunc(minimizeImages(firstUserRaw), 400);
    const finalAgentRaw = agg.finalAgent ?? "";
    const final_agent = trunc(minimizeImages(finalAgentRaw), 400);

    // project — dominant cwd across tool-using events; fallback to session
    let project = sessionFallbackProject;
    if (agg.cwdCounts.size > 0) {
      const best = [...agg.cwdCounts.entries()].sort((a, b) => b[1] - a[1])[0]!;
      project = canonicalProjectName(best[0]);
    }

    // top_tools
    const top_tools = buildTopTools(closed);

    // skills + subagents
    const skills: Record<string, number> = Object.fromEntries(skillsMap);
    const subagents: Entry["subagents"] = closed.flatMap(t => t.subagents);

    // satisfaction + input sources (from human user events)
    const humanText = dayEvents
      .filter(ev => {
        const v = viewEvent(ev);
        if (v.rawType !== "user") return false;
        const content = v.content;
        const isToolResultOnly = content.length > 0
          && content.every((c) => c.type === "tool_result");
        if (isToolResultOnly) return false;
        const text = blockText(ev.blocks) || ev.preview || "";
        return classifyUserInputSource(text) === "human";
      })
      .map(ev => blockText(ev.blocks) || ev.preview || "")
      .join("\n");

    const satisfaction_signals = countSatisfactionSignals(humanText);

    // user_input_sources: tally across all non-tool-result user events
    const user_input_sources = {
      human: 0,
      teammate: 0,
      skill_load: 0,
      slash_command: 0,
      system_instruction: 0,
    };
    for (const ev of dayEvents) {
      const v = viewEvent(ev);
      if (v.rawType !== "user") continue;
      const content = v.content;
      const isToolResultOnly = content.length > 0
        && content.every((c) => c.type === "tool_result");
      if (isToolResultOnly) continue;
      const text = blockText(ev.blocks) || ev.preview || "";
      const src = classifyUserInputSource(text);
      user_input_sources[src]++;
    }

    const pendingUserInstructions = extractUserInstructions(humanText).slice(0, 5);
    const trivial = isTrivial(numbers);

    const entry: Entry = {
      version: CURRENT_ENTRY_SCHEMA_VERSION,
      agent: sessionDetail.agent,
      session_id: sessionDetail.id,
      local_day,
      project,
      start_iso: agg.start_iso,
      end_iso: agg.end_iso,
      numbers,
      flags,
      primary_model: primaryModel,
      model_mix: modelMix,
      first_user,
      final_agent,
      pr_titles: agg.prTitles,
      ...(agg.githubRepos.length ? { github_repos: agg.githubRepos } : {}),
      ...(agg.editedDirs.length ? { edited_dirs: agg.editedDirs } : {}),
      top_tools,
      skills,
      subagents,
      satisfaction_signals,
      user_input_sources,
      enrichment: trivial
        ? skippedTrivialEnrichment(generatedAt)
        : { ...pendingEnrichment(), user_instructions: pendingUserInstructions },
      generated_at: generatedAt,
      source_jsonl: sessionDetail.filePath ?? "",
      source_checkpoint: { byte_offset: 0, last_event_ts: agg.end_iso || null },
    };
    entry.signals = computeEntrySignals(entry);
    entries.push(entry);
  }

  entries.sort((a, b) => a.local_day.localeCompare(b.local_day));
  return entries;
}

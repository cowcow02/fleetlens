/**
 * Core types for parsing Claude Code JSONL transcripts.
 *
 * Claude Code writes one line per logical event to
 * `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`. These types
 * model the *structured* shape of those events after parsing.
 */

export type EventRole =
  | "user"
  | "agent"
  | "agent-thinking"
  | "tool-call"
  | "tool-result"
  | "system"
  | "meta";

export type Usage = {
  /** Fresh prompt tokens the model saw this request */
  input: number;
  /** Output tokens the model generated this request */
  output: number;
  /** Tokens read from prompt cache (cheap, billed lower) */
  cacheRead: number;
  /** Tokens written to prompt cache (one-time cost) */
  cacheWrite: number;
};

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: unknown;
      /** True when the tool invocation failed. */
      is_error?: boolean;
    };

export type SessionEvent = {
  /** 0-based index in the JSONL file. Stable id for selection / scroll. */
  index: number;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  /** ms relative to session start */
  tOffsetMs?: number;
  /** delta to previous conversational event (user/agent/tool) */
  gapMs?: number;
  role: EventRole;
  /** raw JSONL top-level type, for debug panel */
  rawType: string;
  /** assistant message.id — used to dedupe per-block usage aggregation */
  messageId?: string;
  /** assistant stop_reason when present (for interrupt detection) */
  stopReason?: string;
  /** single-line preview for list rendering */
  preview: string;
  /** full content blocks, for drawers */
  blocks: ContentBlock[];
  usage?: Usage;
  model?: string;
  requestId?: string;
  toolName?: string;
  toolUseId?: string;
  toolResult?: unknown;
  /** raw attachment type when role=system */
  attachmentType?: string;
  /** Set on the first assistant event after the prompt cache was
   *  invalidated. Two triggers: `"idle"` (previous API call > 5 min ago,
   *  TTL expired) or `"compact"` (a `compact_boundary` summarized the
   *  conversation — the new summary must be written to a fresh cache). */
  coldResume?: {
    trigger: "idle" | "compact";
    gapMs: number;
    writeTokens: number;
    /** cacheWrite / (cacheWrite + cacheRead). ~1.0 is fully cold; compact
     *  rebuilds sit 0.5–0.75 since some post-summary context warms fast. */
    writeRatio: number;
    compact?: {
      trigger: "manual" | "auto";
      preTokens: number;
    };
  };
  /** full raw JSONL line — for debug panel */
  raw: unknown;
  /** Set when this user event is a cross-session team message delivery.
   *  The event is NOT real human input — it's an inbound `<teammate-message>`
   *  wrapper from a sibling team session. `teammateId` is the sender. */
  teammateMessage?: {
    teammateId: string;
    body: string;
    kind:
      | "message"
      | "idle-notification"
      | "shutdown-request"
      | "shutdown-approved"
      | "task-assignment"
      | "teammate-terminated";
  };
};

/**
 * Which coding-agent tool produced this transcript.
 *
 * Plugin-friendly: `string` so an in-tree adapter can declare any kind
 * without widening a closed union. The two built-in kinds are
 * "claude-code" and "codex"; future adapters (gemini-cli, opencode, …)
 * pick their own lowercase-hyphenated id.
 *
 * Consumers should look up runtime metadata via getAgentSource(kind)
 * (in @claude-lens/parser/fs) rather than switching on string values.
 */
export type AgentKind = string;

export type SessionMeta = {
  /** Source agent. Defaults to "claude-code" for legacy callers. */
  agent?: AgentKind;
  /** URL-safe id — the session UUID, derived from the file name */
  id: string;
  /** absolute path to the JSONL file */
  filePath: string;
  /** human-readable project path (/Users/me/Repo/agentfleet) */
  projectName: string;
  /** Linked worktree name when this session ran from a secondary checkout. */
  worktreeName?: string;
  /** GitHub repo name from the origin remote, when the checkout has one. */
  repoName?: string;
  /** raw dir name under ~/.claude/projects/ */
  projectDir: string;
  sessionId: string;
  firstTimestamp?: string;
  lastTimestamp?: string;
  /** Wall-clock (epoch ms) of the most recent activity for liveness, taking
   *  nested transcripts into account: max(lastTimestamp, newest mtime across
   *  the session's `subagents/` + `workflows/` sidecar files). Lets the LIVE
   *  indicator fire while the main transcript sits idle but a background agent
   *  or a Workflow run is still churning. Computed fresh at scan time (NOT in
   *  the mtime-keyed meta cache — the main JSONL's mtime doesn't change when
   *  only nested files do). */
  lastActivityMs?: number;
  durationMs?: number;
  eventCount: number;
  model?: string;
  cwd?: string;
  gitBranch?: string;
  /** Top-level `entrypoint` field Claude Code stamps on its meta lines.
   *  Known values: "cli" (interactive REPL), "sdk-cli" (`claude -p`),
   *  "sdk-ts" (TS Agent SDK), "claude-desktop". Surfaced on the session
   *  page so the cli/sdk distinction is visible without re-parsing. */
  entrypoint?: string;
  totalUsage: Usage;
  status: "idle" | "running";
  /** derived: first user message preview — used in list cards */
  firstUserPreview?: string;
  /** derived: most recent user message preview — used by the live widget
   *  to surface "what am I currently working on" instead of showing the
   *  (often stale) first message from hours ago. */
  lastUserPreview?: string;
  /** derived: last "conclusion" agent message preview — used in list cards */
  lastAgentPreview?: string;
  /** derived: number of tool calls across the session */
  toolCallCount?: number;
  /** derived: number of user↔agent turns (user inputs count) */
  turnCount?: number;
  /** derived: total lines added across all Edit + Write tool calls */
  linesAdded?: number;
  /** derived: total lines removed across all Edit tool calls */
  linesRemoved?: number;
  /** derived: number of unique files touched (Edit + Write) */
  filesEdited?: number;
  /** derived: count of turns flagged with `coldResume` (idle + compact) */
  coldResumeCount?: number;
  /** derived: sum of cacheWrite across flagged turns — the "cache rebuild
   *  tax" billed against the 5h budget at 1.25× base input price. */
  cacheRebuildTokens?: number;
  /** derived: sum of event-to-event gaps under the idle threshold
   *  (default 3 minutes) — a close approximation of "how long was
   *  the agent actively working" without counting user-away time,
   *  lid-closed time, or other long idle gaps. */
  airTimeMs?: number;
  /** derived: contiguous active segments (same 3-minute idle split as
   *  airTimeMs). Used by parallelism detection and mini-Gantts so
   *  long-idle sessions don't get counted as "active" while dead. */
  activeSegments?: { startMs: number; endMs: number }[];
  /** Team identifier — present on every event when a session participates in a team.
   *  Derived from the top-level `teamName` field that Claude Code writes on all
   *  events in team sessions. First non-empty value wins. */
  teamName?: string;
  /** Canonical teammate id for this session. Present on member sessions,
   *  undefined on leads. Derived from the top-level `agentName` field that
   *  Claude Code writes on all events in a member session. Used to pair
   *  lead-side SendMessage.to values directly. */
  agentName?: string;
  /** True only when this session has actual team-orchestration activity:
   *  a TeamCreate tool_use, OR an outbound SendMessage to a non-lead
   *  recipient. A bare `teamName` field isn't enough — Claude Code can
   *  tag a one-off chat with whatever team context happened to be active.
   *  Gate "is this session a team lead" UI on this flag. */
  isTeamLead?: boolean;
  /** derived: number of dynamic-workflow runs dispatched via the Workflow
   *  tool — one per `<session-uuid>/workflows/wf_*.json` journal. A single
   *  Workflow tool call collapses a whole fan-out into one transcript row;
   *  this surfaces that the row was actually a workflow. */
  workflowCount?: number;
  /** derived: total agents spawned across every workflow run (sum of each
   *  journal's `agentCount`). The real fleet size a session orchestrated —
   *  invisible in the parent transcript, which only logs the Workflow call. */
  spawnedAgentCount?: number;
  /** derived: per-local-day split of tokens/tool-calls/turns, bucketed by each
   *  event's own timestamp so a cross-midnight session reports real usage on
   *  each day. Invariant: sum(dailyBreakdown.tokens) === totalUsage. Absent for
   *  sources that don't populate it (codex/gemini/antigravity) → start-day fallback. */
  dailyBreakdown?: { day: string; toolCalls: number; turns: number; tokens: Usage }[];
};

/**
 * One subagent invocation. Claude Code stores subagent transcripts in a
 * sibling `<session-uuid>/subagents/agent-<agentId>.jsonl` (+ .meta.json)
 * structure. Every line in those files carries `isSidechain: true` and
 * the `agentId`. We surface them as a separate timeline so the UI can
 * visualize parallelism — e.g. a background research agent that ran for
 * 5 minutes alongside the main session.
 */
export type SubagentRun = {
  /** Internal id from the file name and `agentId` field on every line. */
  agentId: string;
  /** From meta.json — "general-purpose", "Explore", or a custom subagent type. */
  agentType: string;
  /** Short human description from meta.json — usually the prompt's `description`. */
  description: string;
  /** Wall-clock start (first event ts in the subagent transcript) */
  startMs?: number;
  /** Wall-clock end (last event ts in the subagent transcript) */
  endMs?: number;
  /** Subagent duration in ms */
  durationMs?: number;
  /** Start time relative to the parent session's t=0, in ms */
  startTOffsetMs?: number;
  /** End time relative to the parent session's t=0, in ms */
  endTOffsetMs?: number;
  /** Number of JSONL events in the subagent transcript */
  eventCount: number;
  /** Aggregate token usage of the subagent (deduped per message.id) */
  totalUsage: Usage;
  /** Parent assistant message uuid that issued the Agent tool_use call */
  parentUuid?: string;
  /** Parent Agent tool_use id, when matchable via description */
  parentToolUseId?: string;
  /** Whether the parent dispatched it with run_in_background=true */
  runInBackground?: boolean;
  /** Final text output from the subagent (last assistant text block), truncated */
  finalPreview?: string;
  /** Full text of the final assistant message (untruncated) */
  finalText?: string;
  /** Full prompt the parent sent via the Agent tool_use.input.prompt — the
   *  task description that the subagent was given. */
  prompt?: string;
  /** Model the subagent ran on (from the first assistant line's message.model) */
  model?: string;
  /** Per-tool-name call counts, ordered by count desc */
  toolCalls?: { name: string; count: number }[];
  /** Tool-call count total (sum of all toolCalls[i].count) */
  toolCallCount?: number;
  /** Number of assistant messages the subagent emitted */
  assistantMessageCount?: number;
};

/**
 * One agent the workflow spawned, from a `workflow_agent` entry in the
 * journal's `workflowProgress`. Each carries the phase it ran in plus the
 * task prompt, result, and per-agent metering — enough to review what
 * actually happened inside a run, even though the agent has no standalone
 * transcript file.
 */
export type WorkflowAgentRun = {
  /** Spawn order within the run (1-based). */
  index: number;
  /** Short label, e.g. "build:s-r2-silent-enrich" / "review:…" / "ci:…". */
  label: string;
  /** 1-based phase this agent belongs to (matches WorkflowRun.phases order). */
  phaseIndex?: number;
  /** Phase title as recorded on the agent entry. */
  phaseTitle?: string;
  /** Internal agent id from the runtime. */
  agentId?: string;
  /** Model the agent ran on. */
  model?: string;
  /** Terminal/last state: "done" | "running" | "error" | "failed" | … */
  state?: string;
  /** Wall-clock start (epoch ms). */
  startedAt?: number;
  /** Agent duration in ms. */
  durationMs?: number;
  /** Tokens the agent consumed. */
  tokens?: number;
  /** Tool calls the agent made. */
  toolCalls?: number;
  /** Last tool summary line (one-liner of its final action). */
  lastToolSummary?: string;
  /** The task prompt the agent was dispatched with (truncated). */
  promptPreview?: string;
  /** The agent's returned result (truncated). */
  resultPreview?: string;
};

/**
 * One dynamic-workflow run dispatched via the `Workflow` tool. Unlike a
 * subagent (a single background transcript), a workflow orchestrates many
 * internal agents and persists an aggregate journal to a sibling
 * `<session-uuid>/workflows/wf_*.json`. We surface each journal as a
 * first-class run so the UI can show the real fan-out (agentCount, tokens,
 * tool calls) that the parent transcript collapses into one opaque tool call.
 */
export type WorkflowRun = {
  /** Run id from the journal (`wf_…`), also the file stem. */
  runId: string;
  /** `meta.name` of the workflow script (journal `workflowName`). */
  name: string;
  /** `meta.description` / journal `summary` — the one-line intent. */
  description?: string;
  /** Journal status: "completed" | "running" | "failed" | "aborted" | … */
  status: string;
  /** Number of agents the workflow spawned across its lifetime. */
  agentCount: number;
  /** Total tool calls summed across every spawned agent (`totalToolCalls`). */
  toolCallCount: number;
  /** Total tokens summed across every spawned agent (`totalTokens`). No
   *  input/output/cache split is recorded in the journal, so this stays
   *  separate from the session's `totalUsage` rather than being folded in. */
  totalTokens: number;
  /** Wall-clock duration of the whole run, in ms. */
  durationMs?: number;
  /** Wall-clock start (epoch ms, journal `startTime`). */
  startMs?: number;
  /** Wall-clock end (startMs + durationMs). */
  endMs?: number;
  /** Start relative to the parent session's t=0, in ms. */
  startTOffsetMs?: number;
  /** End relative to the parent session's t=0, in ms. */
  endTOffsetMs?: number;
  /** Default model the workflow ran its agents on (`defaultModel`). */
  model?: string;
  /** Declared phases (`meta.phases`) — title + optional one-line detail. */
  phases: { title: string; detail?: string }[];
  /** Human progress log lines (▶ / ✓ task markers) emitted during the run. */
  logs: string[];
  /** Per-agent runs (from `workflowProgress`), grouped in the UI by phase.
   *  Empty for older journals that predate `workflowProgress`. */
  agents: WorkflowAgentRun[];
  /** Parent `Workflow` tool_use id, when matchable by dispatch time. */
  parentToolUseId?: string;
  /** Parent assistant message uuid that issued the Workflow tool_use. */
  parentUuid?: string;
};

export type SessionDetail = SessionMeta & {
  events: SessionEvent[];
  /** Sub-agent runs spawned during this session, sorted by start time. */
  subagents?: SubagentRun[];
  /** Dynamic-workflow runs dispatched during this session, sorted by start. */
  workflows?: WorkflowRun[];
};

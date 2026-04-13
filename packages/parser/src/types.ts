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
  | { type: "tool_result"; tool_use_id: string; content: unknown };

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
  /** full raw JSONL line — for debug panel */
  raw: unknown;
};

export type SessionMeta = {
  /** URL-safe id — the session UUID, derived from the file name */
  id: string;
  /** absolute path to the JSONL file */
  filePath: string;
  /** human-readable project path (/Users/me/Repo/agentfleet) */
  projectName: string;
  /** raw dir name under ~/.claude/projects/ */
  projectDir: string;
  sessionId: string;
  firstTimestamp?: string;
  lastTimestamp?: string;
  durationMs?: number;
  eventCount: number;
  model?: string;
  cwd?: string;
  gitBranch?: string;
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
  /** derived: sum of event-to-event gaps under the idle threshold
   *  (default 3 minutes) — a close approximation of "how long was
   *  the agent actively working" without counting user-away time,
   *  lid-closed time, or other long idle gaps. */
  airTimeMs?: number;
  /** derived: contiguous active segments (same 3-minute idle split as
   *  airTimeMs). Used by parallelism detection and mini-Gantts so
   *  long-idle sessions don't get counted as "active" while dead. */
  activeSegments?: { startMs: number; endMs: number }[];
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

export type SessionDetail = SessionMeta & {
  events: SessionEvent[];
  /** Sub-agent runs spawned during this session, sorted by start time. */
  subagents?: SubagentRun[];
};

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
  /** derived: last "conclusion" agent message preview — used in list cards */
  lastAgentPreview?: string;
  /** derived: number of tool calls across the session */
  toolCallCount?: number;
  /** derived: number of user↔agent turns (user inputs count) */
  turnCount?: number;
};

export type SessionDetail = SessionMeta & {
  events: SessionEvent[];
};

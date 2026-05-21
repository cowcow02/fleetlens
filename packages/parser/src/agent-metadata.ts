/**
 * Pure metadata records for each registered agent.
 *
 * Browser-safe: no fs / node-* imports, so client components can render
 * agent badges and labels without dragging the Node-only file readers
 * into the bundle. The full executable registry (with listSessions /
 * getSession / usagePoller methods) lives in `@claude-lens/parser/fs`
 * and is server-only.
 *
 * Adding a new agent: add a new metadata record here AND a new source
 * object in `fs.ts` that references it. The metadata is the single
 * source of truth for kind / displayName / shortLabel / accentColor —
 * fs.ts just adds the read methods on top.
 */

import type { AgentKind } from "./types.js";

export type AgentMetadata = {
  /** Stable id, lowercased, hyphenated. */
  kind: AgentKind;
  /** Full human-readable name. Used in headers, prompts, sidebar tagline. */
  displayName: string;
  /** Pill-friendly short label. Used in inline badges and chips. */
  shortLabel: string;
  /** CSS color used everywhere this agent surfaces. */
  accentColor: string;
  /** Single-character glyph evoking the agent's brand. Rendered in
   *  accentColor wherever a tiny inline visual cue is needed (Gantt
   *  rails, outcome pills, list rows). Pick something that reads at 10px. */
  iconChar: string;
};

export const CLAUDE_CODE_METADATA: AgentMetadata = {
  kind: "claude-code",
  displayName: "Claude Code",
  shortLabel: "Claude",
  accentColor: "var(--af-accent)",
  iconChar: "✦",
};

export const CODEX_METADATA: AgentMetadata = {
  kind: "codex",
  displayName: "Codex (OpenAI)",
  shortLabel: "Codex",
  accentColor: "rgb(16, 163, 127)",
  iconChar: "◆",
};

export const GEMINI_METADATA: AgentMetadata = {
  kind: "gemini",
  displayName: "Gemini CLI",
  shortLabel: "Gemini",
  accentColor: "rgb(124, 92, 246)",
  iconChar: "✺",
};

export const ANTIGRAVITY_METADATA: AgentMetadata = {
  kind: "antigravity",
  displayName: "Antigravity",
  shortLabel: "Agy",
  accentColor: "rgb(236, 72, 153)",
  iconChar: "⏃",
};

/** Ordered list of registered agent metadata. UI iterates this for
 *  badges, tabs, and prompt-template generation. */
export const agentMetadata: AgentMetadata[] = [
  CLAUDE_CODE_METADATA,
  CODEX_METADATA,
  GEMINI_METADATA,
  ANTIGRAVITY_METADATA,
];

/** Browser-safe metadata lookup. Returns undefined for unknown kinds. */
export function getAgentMetadata(kind: AgentKind): AgentMetadata | undefined {
  return agentMetadata.find((m) => m.kind === kind);
}

const KNOWN_AGENT_KINDS = new Set(agentMetadata.map((m) => m.kind));

/** Type guard that narrows an unknown string to a registered AgentKind. */
export function isAgentKind(s: string | undefined | null): s is AgentKind {
  return typeof s === "string" && KNOWN_AGENT_KINDS.has(s);
}

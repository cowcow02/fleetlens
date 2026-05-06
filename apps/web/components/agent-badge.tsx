import type { AgentKind } from "@claude-lens/parser";
import { getAgentMetadata } from "@claude-lens/parser";

type AgentBadgeProps = {
  /** Source agent. Undefined is treated as legacy claude-code (no badge). */
  agent?: AgentKind;
};

/**
 * Inline agent pill. Registry-driven: pulls accentColor + shortLabel
 * directly off the AgentSource. Adding a new agent makes a new badge
 * appear automatically with the source's declared color — no edits
 * needed here.
 *
 * Returns null for "claude-code" (legacy default-hide so existing
 * Claude rows render unchanged) and for unknown kinds.
 */
export function AgentBadge({ agent }: AgentBadgeProps) {
  if (!agent || agent === "claude-code") return null;
  const meta = getAgentMetadata(agent);
  if (!meta) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 4,
        padding: "2px 6px",
        fontSize: 10,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        fontWeight: 600,
        color: meta.accentColor,
        background: `color-mix(in srgb, ${meta.accentColor} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${meta.accentColor} 30%, transparent)`,
      }}
      title={`Source: ${meta.displayName}`}
    >
      {meta.shortLabel}
    </span>
  );
}

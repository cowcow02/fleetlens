import type { AgentKind } from "@claude-lens/parser";
import { getAgentMetadata } from "@claude-lens/parser";

type Props = {
  agent?: AgentKind;
  /** Glyph size in px. Defaults to inherit-from-context (12 typical). */
  size?: number;
  /** Spoken label override; defaults to the agent's displayName. */
  title?: string;
};

/** Single-glyph agent indicator: ✦ for Claude, ◆ for Codex (or whatever
 *  the registered metadata declares), painted in the agent's accent color.
 *  Returns null for unknown / undefined agents. */
export function AgentIcon({ agent, size = 11, title }: Props) {
  if (!agent) return null;
  const meta = getAgentMetadata(agent);
  if (!meta) return null;
  return (
    <span
      aria-hidden
      title={title ?? meta.displayName}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        width: size + 2,
        height: size + 2,
        fontSize: size,
        lineHeight: 1,
        color: meta.accentColor,
      }}
    >
      {meta.iconChar}
    </span>
  );
}

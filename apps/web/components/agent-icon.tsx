import type { AgentKind } from "@claude-lens/parser";
import { getAgentMetadata } from "@claude-lens/parser";

type Props = {
  agent?: AgentKind;
  /** Glyph size in px. Defaults to inherit-from-context (12 typical). */
  size?: number;
  /** Spoken label override; defaults to the agent's displayName. */
  title?: string;
};

/**
 * Grok mark path data from OpenUsage ProviderIcons/grok.svg (MIT)
 * https://github.com/robinebers/openusage
 * viewBox 0 0 527.27 578.68
 */
const GROK_MARK_PATH =
  "M274.67 360.75 L527.27 0 L405.19 0 L213.64 273.58 Z M122.08 578.68 L183.12 491.51 L122.08 404.34 L0 578.68 Z M274.67 578.68 L396.75 578.68 L122.08 186.40 L0 186.40 Z M527.27 43.59 L427.27 186.40 L437.27 578.68 L517.27 578.68 Z";

/** Single-glyph agent indicator painted in the agent's accent color.
 *  Grok uses the OpenUsage provider mark; other agents use iconChar. */
export function AgentIcon({ agent, size = 11, title }: Props) {
  if (!agent) return null;
  const meta = getAgentMetadata(agent);
  if (!meta) return null;
  const label = title ?? meta.displayName;

  if (agent === "grok") {
    return (
      <span
        aria-hidden
        title={label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          width: size + 2,
          height: size + 2,
          color: meta.accentColor,
        }}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 527.27 578.68"
          fill="currentColor"
          aria-hidden
          style={{ display: "block" }}
        >
          <path d={GROK_MARK_PATH} />
        </svg>
      </span>
    );
  }

  return (
    <span
      aria-hidden
      title={label}
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

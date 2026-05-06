import type { AgentBreakdown } from "@claude-lens/parser";
import { getAgentMetadata } from "@claude-lens/parser";

/**
 * Inline chip that surfaces "12 Claude · 3 Codex" on a project row when
 * the project has activity from more than one source. Registry-driven:
 * shortLabel + accentColor come from each AgentSource, so adding a new
 * agent auto-appears here without edits.
 *
 * Returns null when there's only one agent — keeps single-agent rows
 * visually unchanged.
 */
export function AgentMixChip({ perAgent }: { perAgent: AgentBreakdown[] }) {
  if (perAgent.length < 2) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10,
        fontFamily: "var(--font-mono)",
        color: "var(--af-text-tertiary)",
        whiteSpace: "nowrap",
      }}
      title="Sessions split by source agent"
    >
      {perAgent.map((row, i) => {
        const meta = getAgentMetadata(row.agent);
        const label = meta?.shortLabel ?? row.agent;
        const color = meta?.accentColor ?? "inherit";
        return (
          <span key={row.agent}>
            {i > 0 && <span style={{ margin: "0 4px", opacity: 0.5 }}>·</span>}
            <span style={{ color, fontWeight: 600 }}>{row.sessions}</span>{" "}
            {label}
          </span>
        );
      })}
    </span>
  );
}

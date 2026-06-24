/**
 * Color-mapping utilities for the session-view minimap and workflow cards.
 *
 * - `subagentColor` — color a sub-agent lane by its declared type.
 *   `background=true` returns a brighter variant used for parallel
 *   (background) runs so they read as more "alive" than blocking
 *   subagents.
 * - `workflowColor` — orange base for workflow lanes, modulated to red
 *   for failures and green for in-flight runs. Deliberately warm so
 *   workflow lanes are visually distinct from the cool subagent palette.
 */

export function subagentColor(agentType: string, background?: boolean): string {
  const palette: Record<string, [string, string]> = {
    "general-purpose": ["#5C84C3", "#7BA3DC"],
    Explore: ["#A855F7", "#C57BFF"],
    Plan: ["#F59E0B", "#FFBD3D"],
    "code-reviewer": ["#34D399", "#5EE5B0"],
    "playwright-qa-verifier": ["#22D3EE", "#67E8F9"],
    "claude-code-guide": ["#EC4899", "#F472B6"],
  };
  const [base, bright] = palette[agentType] ?? ["#8A8580", "#A8A19A"];
  return background ? bright : base;
}

export function workflowColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "failed" || s === "aborted" || s === "error") return "#EF4444";
  if (s === "running" || s === "in_progress" || s === "active") return "#10B981";
  return "#EA580C";
}

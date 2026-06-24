import { canonicalProjectName } from "@claude-lens/parser";

export const ROW_HEIGHT = 30;
export const ROW_GAP = 3;
export const LABEL_WIDTH = 220;
export const HEADER_HEIGHT = 26;
export const BURST_RIBBON_HEIGHT = 24;
export const MIN_CHART_WIDTH = 700;
export const PAD_MS = 30 * 60 * 1000; // 30-min padding on each side

export const PROJECT_COLORS = [
  "rgba(45, 212, 191, 0.75)",
  "rgba(167, 139, 250, 0.75)",
  "rgba(248, 113, 113, 0.75)",
  "rgba(52, 211, 153, 0.75)",
  "rgba(251, 191, 36, 0.75)",
  "rgba(236, 72, 153, 0.75)",
  "rgba(34, 211, 238, 0.75)",
  "rgba(168, 85, 247, 0.75)",
  "rgba(244, 114, 82, 0.75)",
  "rgba(96, 165, 250, 0.75)",
];

/**
 * Hash a project key to a stable color. The key should be a canonical
 * project identity (not a raw projectDir) so all worktrees of the same
 * repo share one color — visually grouping "this repo's parallel work".
 */
export function projectColor(projectKey: string): string {
  let hash = 0;
  for (let i = 0; i < projectKey.length; i++) {
    hash = ((hash << 5) - hash + projectKey.charCodeAt(i)) | 0;
  }
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length]!;
}

/** Color for a Gantt session, keyed by canonical project name. */
export function sessionColor(s: { projectName: string }): string {
  return projectColor(canonicalProjectName(s.projectName));
}

export function stripXml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

export function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

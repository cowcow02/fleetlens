/**
 * @claude-lens/parser
 *
 * Parse Claude Code JSONL transcripts into structured event streams.
 * Pure — no fs, no network. Use the `/fs` subpath for filesystem scanning.
 */

export * from "./types.js";
export * from "./parser.js";
export * from "./presentation.js";
export * from "./analytics.js";
export { groupByTeam } from "./team.js";
export type { TeamView, TeamMessage } from "./team.js";

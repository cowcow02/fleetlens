/**
 * Shared classifier for "framework-injected" user-message text.
 *
 * Some patterns that show up as `user` events in transcripts are NOT real
 * user input — they're boilerplate emitted by the harness wrapping the
 * agent (Claude Code's `<command-name>`, skill loaders, task notifications,
 * Conductor's per-session `<system_instruction>` block, …). Without this
 * filter the first such message becomes the session's "first user message"
 * and pollutes every UI surface that previews user intent: the sessions
 * list, the homepage, project rollups, perception entries, digests.
 *
 * Single source of truth — every adapter (Claude Code, Codex, Gemini) and
 * the perception layer routes through this so adding a new injected
 * pattern is a one-line change.
 */

export const FRAMEWORK_INJECTED_PREFIXES = [
  // Claude Code: stock slash commands and local-shell echoes
  "<command-name>",
  "<local-command-stdout>",
  "<local-command-caveat>",
  // Claude Code: cross-agent task notifications from the Monitor tool
  "<task-notification>",
  // Conductor (multi-agent Mac harness): environment context injected as
  // the first user message of every session
  "<system_instruction",
  // Plugin/skill loader header
  "Base directory for this skill:",
] as const;

/** True when the raw user-message text is framework boilerplate, not a
 *  human-authored turn. Match is prefix-anchored — patterns like
 *  `<system_instruction` (no closing `>`) catch both `<system_instruction>`
 *  and attribute-bearing forms `<system_instruction id="...">`. */
export function isFrameworkInjectedUserInput(rawText: string): boolean {
  if (!rawText) return false;
  for (const prefix of FRAMEWORK_INJECTED_PREFIXES) {
    if (rawText.startsWith(prefix)) return true;
  }
  return false;
}

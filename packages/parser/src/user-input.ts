/**
 * Shared classifier + sanitizer for framework-injected user-message text.
 *
 * Two distinct shapes of noise show up in `user` events:
 *
 *   1. ENTIRELY-INJECTED messages — the whole message is harness boilerplate
 *      with no user prose: skill loads, command-name wrappers, task
 *      notifications, local-command echoes. These should be hidden.
 *
 *   2. WRAPPER-PREFIXED messages — Conductor (multi-agent Mac harness)
 *      prepends a `<system_instruction>...</system_instruction>` block
 *      to every user prompt as ONE combined message. The wrapper is
 *      environment context; the user's real prompt follows it. The wrapper
 *      must be excised, the real prompt preserved.
 *
 * Single source of truth — every adapter (Claude Code, Codex, Gemini) and
 * the perception layer routes through these helpers so adding a new
 * injected pattern is a one-line change.
 */

/** Wrapper blocks that should be excised in-place; the surrounding user
 *  prose (if any) is preserved. */
const STRIPPABLE_WRAPPERS: readonly RegExp[] = [
  /<system_instruction\b[^>]*>[\s\S]*?<\/system_instruction>\s*/gi,
];

/** Prefixes that indicate the entire message is harness boilerplate with no
 *  user prose. Match is prefix-anchored on the post-strip text. */
const ENTIRELY_INJECTED_PREFIXES = [
  // Claude Code: stock slash commands and local-shell echoes
  "<command-name>",
  "<local-command-stdout>",
  "<local-command-caveat>",
  // Claude Code: cross-agent task notifications from the Monitor tool
  "<task-notification>",
  // Plugin/skill loader header
  "Base directory for this skill:",
] as const;

/** Excise wrapper blocks (currently Conductor's `<system_instruction>...`)
 *  from raw user-message text. Leaves the surrounding prose intact and
 *  trims the result. Returns "" if the message was entirely wrapper. */
export function stripFrameworkBoilerplate(rawText: string): string {
  if (!rawText) return rawText;
  let out = rawText;
  for (const re of STRIPPABLE_WRAPPERS) {
    out = out.replace(re, "");
  }
  return out.trim();
}

/** True when the raw user-message text is framework boilerplate with no
 *  human prose worth surfacing. Wrapper-prefixed messages return false
 *  when there's user prose after the wrapper; only fully-empty-after-strip
 *  or entirely-injected messages return true. */
export function isFrameworkInjectedUserInput(rawText: string): boolean {
  if (!rawText) return false;
  const stripped = stripFrameworkBoilerplate(rawText);
  if (!stripped) return true;
  for (const prefix of ENTIRELY_INJECTED_PREFIXES) {
    if (stripped.startsWith(prefix)) return true;
  }
  return false;
}

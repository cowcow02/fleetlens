// Strip wrapper blocks first (Conductor's <system_instruction>), then test
// the residue against ENTIRELY_INJECTED_PREFIXES. Same boundary logic is
// reused by the entries package via cross-package import.

const STRIPPABLE_WRAPPERS: readonly RegExp[] = [
  /<system_instruction\b[^>]*>[\s\S]*?<\/system_instruction>\s*/gi,
];

const ENTIRELY_INJECTED_PREFIXES = [
  "<command-name>",
  "<local-command-stdout>",
  "<local-command-caveat>",
  "<task-notification>",
  "Base directory for this skill:",
  // Harness-authored lines that arrive with role:"user" but are not the
  // human typing. The post-compact continuation is Claude Code restating the
  // summarized conversation; the Stop-hook notice is a skill (e.g. /goal)
  // keeping the turn alive. Neither is a real user message, so they must not
  // render as "User" rows or count toward digest "top user instructions".
  "This session is being continued from a previous conversation",
  "A session-scoped Stop hook is now active",
] as const;

export function stripFrameworkBoilerplate(rawText: string): string {
  if (!rawText) return rawText;
  let out = rawText;
  for (const re of STRIPPABLE_WRAPPERS) {
    out = out.replace(re, "");
  }
  return out.trim();
}

export function isFrameworkInjectedUserInput(rawText: string): boolean {
  if (!rawText) return false;
  const stripped = stripFrameworkBoilerplate(rawText);
  if (!stripped) return true;
  for (const prefix of ENTIRELY_INJECTED_PREFIXES) {
    if (stripped.startsWith(prefix)) return true;
  }
  return false;
}

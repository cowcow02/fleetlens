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

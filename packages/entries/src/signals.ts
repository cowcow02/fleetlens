import { stripFrameworkBoilerplate } from "@claude-lens/parser";
import type {
  Entry, EntrySignals, EntrySubagent, ExternalRefKind,
  PromptFrame, SkillOrigin, SubagentRole, WorkingShape,
} from "./types.js";

export type UserInputSource =
  | "human"
  | "teammate"
  | "skill_load"
  | "slash_command"
  | "system_instruction";

const TEAMMATE_RE = /^<teammate-message\b/;
const SKILL_LOAD_RE = /^Base directory for this skill:/;
const SLASH_COMMAND_RE = /^<command-name>|^<local-command-stdout>/;

/** Classify a user-message turn after first stripping wrapper boilerplate
 *  (Conductor's `<system_instruction>` block). Messages whose remainder
 *  is real user prose classify as "human"; messages that are PURE wrapper
 *  classify as "system_instruction" and aren't counted as human turns. */
export function classifyUserInputSource(text: string): UserInputSource {
  if (!text) return "human";
  const stripped = stripFrameworkBoilerplate(text);
  if (!stripped) return "system_instruction";
  if (TEAMMATE_RE.test(stripped)) return "teammate";
  if (SKILL_LOAD_RE.test(stripped)) return "skill_load";
  if (SLASH_COMMAND_RE.test(stripped)) return "slash_command";
  return "human";
}

const HAPPY_RE = /\b(?:yay|yaay|yass|woohoo|nice|great|love(?:ly)?|perfect|amazing|awesome)\s*!|!!!/gi;
const SATISFIED_RE = /\b(?:thanks|thank you|looks good|lgtm|works|that works|all good|sounds good)\b/gi;
const DISSATISFIED_RE = /\b(?:that'?s (?:not|wrong)|try again|no, (?:that|this)|not quite|incorrect)\b/gi;
const FRUSTRATED_RE = /\b(?:broken|stop|why (?:did|are|would) you|give up|ugh|argh|wtf)\b/gi;

export type SatisfactionCounts = {
  happy: number;
  satisfied: number;
  dissatisfied: number;
  frustrated: number;
};

export function countSatisfactionSignals(text: string): SatisfactionCounts {
  if (!text) return { happy: 0, satisfied: 0, dissatisfied: 0, frustrated: 0 };
  return {
    happy: (text.match(HAPPY_RE) ?? []).length,
    satisfied: (text.match(SATISFIED_RE) ?? []).length,
    dissatisfied: (text.match(DISSATISFIED_RE) ?? []).length,
    frustrated: (text.match(FRUSTRATED_RE) ?? []).length,
  };
}

/**
 * Extract up to 5 explicit user asks.
 * Matches "can you X", "please X", "let's X", "I need X".
 * Returns cleaned X strings ≤ 200 chars.
 */
const INSTRUCTION_RE = /\b(?:can you|please|let's|let us|i need|could you|would you)\s+([^.?!\n]{5,200})/gi;

export function extractUserInstructions(text: string): string[] {
  if (!text) return [];
  // /g + .exec() means INSTRUCTION_RE.lastIndex persists across calls. The
  // out.length >= 5 break below can leave it past end-of-string, which makes
  // the next call's match start mid-input — silently truncating or zeroing
  // user_instructions for entries that follow a 5+ match turn.
  INSTRUCTION_RE.lastIndex = 0;
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = INSTRUCTION_RE.exec(text)) !== null) {
    const phrase = m[1]!.trim().replace(/\s+/g, " ");
    const lc = phrase.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    out.push(phrase);
    if (out.length >= 5) break;
  }
  return out;
}

// ─── Subagent role classification ────────────────────────────────────────

/** Map a subagent's description + prompt_preview to a role label. Order
 *  matters: more specific verbs win. */
export function classifySubagentRole(sa: EntrySubagent): SubagentRole {
  const text = `${sa.description} ${sa.prompt_preview}`.toLowerCase();
  if (/\b(re-?review|review[s]?|verify|audit|spec[- ]review|code[- ]quality|code[- ]reuse|efficiency review|sanity check|quick test)\b/.test(text)) {
    return "reviewer";
  }
  if (/\b(implement|build chunk|build task|initialize|create the|add the)\b/.test(text)) {
    return "implementer";
  }
  if (/\bexplore\b|\binventory\b|\bmap\b.*\b(codebase|repo|branch)\b|\baudit\b.*coverage/.test(text)) {
    return "explorer";
  }
  if (/\b(investigate|research|reverse[- ]engineer|study|analy[sz]e|look up|tell me|brief me on|find out)\b/.test(text)) {
    return "researcher";
  }
  if (/\b(env(?:ironment)? setup|configure|setup|bootstrap)\b/.test(text)) {
    return "env-setup";
  }
  if (/\b(polish|cleanup|fix|refactor)\b/.test(text)) {
    return "polish";
  }
  return "other";
}

/** Subagent types shipped with Claude Code or the public superpowers / mcp /
 *  codex / frontend-design / code-review / claude-code-guide / playwright-qa-verifier
 *  / statusline-setup / Plan / Explore / general-purpose set. Anything else is
 *  treated as user-authored. */
const STOCK_SUBAGENT_PREFIXES = /^(general-purpose|Explore|Plan|claude-code-guide|playwright-qa-verifier|statusline-setup|frontend-design:|code-review:|code-simplifier:|codex:|superpowers:)/;

export function isStockSubagentType(type: string): boolean {
  return STOCK_SUBAGENT_PREFIXES.test(type);
}

// ─── Working-shape inference ─────────────────────────────────────────────

/** Map a single Entry's session-shape from its subagent dispatches + first_user
 *  + skills. Returns null when the entry is too small to characterize (trivial
 *  outcomes, < 1 turn). */
export function inferWorkingShape(entry: Entry): WorkingShape {
  if (entry.numbers.turn_count < 2) return null;

  const subagents = entry.subagents ?? [];
  const roles = subagents.map(classifySubagentRole);
  const reviewerCount = roles.filter(r => r === "reviewer").length;
  const implementerCount = roles.filter(r => r === "implementer").length;
  const explorerOrResearcher = roles.filter(r => r === "explorer" || r === "researcher").length;
  const hasBackground = subagents.some(sa => sa.background);

  // 1. Chunk implementation — 2+ implementer dispatches against numbered
  //    chunks/tasks. Checked first because chunk-implementation sessions
  //    often ALSO carry per-chunk reviewer dispatches; we don't want those
  //    to trip reviewer-triad detection.
  if (implementerCount >= 2) {
    const chunkRefs = subagents.filter(sa => /\b(chunk|task)\s*\d+/i.test(`${sa.description} ${sa.prompt_preview}`));
    if (chunkRefs.length >= 2) return "chunk-implementation";
  }

  // 2. Reviewer triad — 3+ reviewers with distinct lens descriptions, AND
  //    no implementer dispatches in the same session (pure review mode on
  //    a single diff, not chunked work). The defining shape is: same diff
  //    going through 3 different review lenses.
  if (reviewerCount >= 3 && implementerCount === 0) {
    const lensSigs = new Set<string>();
    for (let i = 0; i < subagents.length; i++) {
      if (roles[i] !== "reviewer") continue;
      const sig = subagents[i]!.description.toLowerCase()
        .replace(/[^a-z0-9 ]/g, "")
        .split(/\s+/)
        .filter(w => w.length > 2)
        .slice(0, 3)
        .join("|");
      lensSigs.add(sig);
    }
    if (lensSigs.size >= 3) return "reviewer-triad";
  }

  // 3. Spec-review loop — 2+ reviewer dispatches.
  if (reviewerCount >= 2) return "spec-review-loop";

  // 4. Research-then-build — explorer/researcher dispatches present AND
  //    implementer dispatches OR substantial post-research work.
  if (explorerOrResearcher >= 2 || (explorerOrResearcher >= 1 && implementerCount >= 1)) {
    return "research-then-build";
  }

  // 5. Background-coordinated — any background:true subagent + foreground work.
  if (hasBackground && subagents.length >= 1) return "background-coordinated";

  // 6. Solo shapes (no subagents).
  if (subagents.length === 0) {
    const first = (entry.first_user || "").trim().toLowerCase();
    if (/^continue\b/.test(first) || first === "continue.") return "solo-continuation";
    const skills = Object.keys(entry.skills ?? {});
    if (skills.some(s => /brainstorm|writing-plans|brainstorming/i.test(s))) return "solo-design";
    return "solo-build";
  }

  // Mixed but doesn't match a named pattern — fall through to solo-build.
  return "solo-build";
}

// ─── Prompt-frame detection ──────────────────────────────────────────────

export function detectPromptFrames(text: string | null | undefined): PromptFrame[] {
  if (!text) return [];
  const out: PromptFrame[] = [];
  if (/<teammate-message\b/i.test(text)) out.push("teammate");
  if (/<task-notification\b/i.test(text)) out.push("task-notification");
  if (/<local-command-caveat\b/i.test(text)) out.push("local-command-caveat");
  if (/<command-(message|name)\b/i.test(text)) out.push("slash-command");
  if (/\[Image #\d+\]/.test(text)) out.push("image-attached");
  if (
    /\b(here'?s the (handoff|handover) prompt|session-close summary|wrap-up summary|all wrapped up|all captured\.)\b/i.test(text)
    || /^##? (Wrap-up|Session conclusion|Handoff)\b/m.test(text)
    || /^# Handoff:/m.test(text)
  ) {
    out.push("handoff-prose");
  }
  return out;
}

// ─── Skill origin classification ─────────────────────────────────────────

const STOCK_SKILL_PREFIXES = /^(superpowers|mcp__|frontend-design|code-review|codex|claude-code-guide|claude-api):/i;

export function classifySkill(name: string): SkillOrigin {
  if (name.startsWith("(ToolSearch:")) return "infra";
  if (STOCK_SKILL_PREFIXES.test(name)) return "stock";
  if (name === "using-superpowers") return "stock";
  return "user";
}

// ─── External-reference detection ────────────────────────────────────────

const EXTERNAL_REF_PATTERNS: Array<{ kind: ExternalRefKind; re: RegExp }> = [
  // Linear/Jira-style ticket ids. 2+ digits keeps model names (GPT-5) out;
  // the denylist drops the common spec/hash tokens that share the shape.
  { kind: "ticket-ref", re: /\b(?!(?:SHA|ISO|RFC|CVE)-)[A-Z]{2,10}-\d{2,}\b/ },
  { kind: "github-issue-pr", re: /\b(issue|pr|pull request)\s*#\d+\b|github\.com\/[^\s]+\/(issues|pull)\/\d+/i },
  { kind: "branch-ref", re: /\b(branch|feat|fix|chore|refactor)[/:]\s*[\w./-]+|on `[\w./-]+`/i },
  { kind: "url", re: /https?:\/\/\S+/ },
];

export function detectExternalRef(text: string | null | undefined): { kind: ExternalRefKind; preview: string } | null {
  if (!text) return null;
  // Skip Claude-feature framings — those are harness handoffs, not external delegation.
  if (/<teammate-message|<task-notification|<local-command-caveat/i.test(text.slice(0, 400))) return null;
  for (const { kind, re } of EXTERNAL_REF_PATTERNS) {
    const m = text.match(re);
    if (m) return { kind, preview: text.slice(0, 160) };
  }
  return null;
}

// ─── Verbosity bucket ────────────────────────────────────────────────────

export function bucketVerbosity(n: number): "short" | "medium" | "long" | "very_long" {
  if (n < 100) return "short";
  if (n < 500) return "medium";
  if (n < 2000) return "long";
  return "very_long";
}

// ─── Canonical Entry signals computation ─────────────────────────────────

/** Produce the full EntrySignals object from an Entry. Called at Entry-build
 *  time and by aggregation consumers as a fallback when entry.signals is
 *  absent (cached pre-refactor entries). Pure / deterministic / no LLM. */
export function computeEntrySignals(entry: Entry): EntrySignals {
  const fu = entry.first_user || "";
  const verbosity = bucketVerbosity(fu.length);
  const ext = detectExternalRef(fu);
  const external_refs = ext ? [ext] : [];

  const skillNames = Object.keys(entry.skills ?? {});
  const brainstorm_warmup = skillNames.some(s => /brainstorm|writing-plans/i.test(s));

  const fuTrim = fu.trim().toLowerCase();
  const frames = detectPromptFrames(fu);
  const continuation_kind: EntrySignals["continuation_kind"] =
    /^continue\b/.test(fuTrim) || fuTrim === "continue."
      ? "literal-continue"
      : frames.includes("handoff-prose")
        ? "handoff-prose"
        : "none";

  return {
    working_shape: inferWorkingShape(entry),
    prompt_frames: frames,
    subagent_roles: (entry.subagents ?? []).map(classifySubagentRole),
    verbosity,
    external_refs,
    brainstorm_warmup,
    continuation_kind,
  };
}

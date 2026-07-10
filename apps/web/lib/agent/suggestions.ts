import { z } from "zod";
import type { IndexDoc } from "./types";

/** One clickable empty-state chip. The four categories are the capability
 *  menu (recap / find / synthesize / handoff); personalization only changes
 *  the wording, never the shape. */
export type Suggestion = {
  label: string;
  category: "recap" | "find" | "synthesize" | "handoff";
};

export const FALLBACK_SUGGESTIONS: Suggestion[] = [
  { label: "What did I work on yesterday?", category: "recap" },
  { label: "Find the sessions behind my most recent fix", category: "find" },
  { label: "Which projects did I touch this week, and what happened in each?", category: "synthesize" },
  { label: "Draft a prompt to continue my most recent feature work, with full context", category: "handoff" },
];

const LABEL_MAX = 120;
const RECENT_WINDOW_MS = 7 * 86_400_000;

function shortName(project: string): string {
  const parts = project.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? project;
}

type ActiveProject = { project: string; display: string; sessions: number; lastDay: string };

function byRecentActivity(docs: IndexDoc[], nowMs: number): ActiveProject[] {
  const cutoff = nowMs - RECENT_WINDOW_MS;
  const agg = new Map<string, { display: string; sessions: number; lastDay: string }>();
  for (const d of docs) {
    const ms = d.startIso ? Date.parse(d.startIso) : NaN;
    if (Number.isNaN(ms) || ms < cutoff) continue;
    const cur = agg.get(d.project) ?? { display: shortName(d.project), sessions: 0, lastDay: "" };
    cur.sessions++;
    if (d.day > cur.lastDay) cur.lastDay = d.day;
    // The git remote's repo name is what the rest of the UI shows.
    if (d.repoName) cur.display = d.repoName;
    agg.set(d.project, cur);
  }
  return Array.from(agg.entries())
    .map(([project, v]) => ({ project, ...v }))
    .sort((a, b) => b.lastDay.localeCompare(a.lastDay) || b.sessions - a.sessions);
}

/** LLM-free personalization tier: template-fill the four categories from
 *  recent activity. Used when AI features are off, the LLM call fails, or
 *  nothing is cached yet. The top project appears at most twice; the find
 *  chip goes to the runner-up project so the set doesn't read as a loop. */
export function deterministicSuggestions(docs: IndexDoc[], nowMs: number): Suggestion[] {
  const active = byRecentActivity(docs, nowMs);
  const top = active[0];
  if (!top) return FALLBACK_SUGGESTIONS;
  const second = active[1];
  return [
    { label: "What did I work on yesterday?", category: "recap" },
    second
      ? { label: `Find the sessions where I worked on ${second.display}`, category: "find" }
      : { label: "Find the sessions behind my most recent fix", category: "find" },
    { label: `Summarize this week's work on ${top.display}`, category: "synthesize" },
    { label: `Draft a prompt to continue my latest ${top.display} work, with full context`, category: "handoff" },
  ];
}

/** Staleness key for the cached LLM suggestions: any new session (or a
 *  re-indexed newest session) invalidates. */
export function suggestionInputKey(docs: IndexDoc[]): string {
  let newestIso = "";
  let newestId = "";
  for (const d of docs) {
    const iso = d.startIso ?? "";
    if (iso > newestIso) {
      newestIso = iso;
      newestId = d.sessionId;
    }
  }
  return `${newestId}|${newestIso}|${docs.length}`;
}

const CONTEXT_PROJECTS = 3;
const CONTEXT_TITLES = 8;
const CONTEXT_BRIEFS = 6;

/** Compact activity digest fed to the suggestion model. */
export function buildSuggestionContext(docs: IndexDoc[], nowMs: number): string {
  const today = new Date(nowMs);
  const lines: string[] = [];
  lines.push(`Today: ${today.toLocaleDateString("en-CA")} (${today.toLocaleDateString("en-US", { weekday: "long" })})`);

  const active = byRecentActivity(docs, nowMs).slice(0, CONTEXT_PROJECTS);
  lines.push("", "Most active projects (last 7 days):");
  for (const p of active) {
    lines.push(`- ${p.display} — ${p.sessions} sessions, last active ${p.lastDay}`);
  }

  const displayFor = (d: IndexDoc) => d.repoName ?? shortName(d.project);
  const recent = [...docs]
    .sort((a, b) => (b.startIso ?? "").localeCompare(a.startIso ?? ""))
    .slice(0, CONTEXT_TITLES);
  lines.push("", "Most recent sessions:");
  for (const d of recent) {
    lines.push(`- [${d.day}] ${displayFor(d)}: ${d.title}`);
  }

  const briefs: string[] = [];
  for (const d of recent) {
    for (const c of d.chunks) {
      if (c.role !== "summary") continue;
      briefs.push(`- ${displayFor(d)}: ${c.text}`);
      if (briefs.length >= CONTEXT_BRIEFS) break;
    }
    if (briefs.length >= CONTEXT_BRIEFS) break;
  }
  if (briefs.length > 0) {
    lines.push("", "AI summaries of recent sessions:");
    lines.push(...briefs);
  }
  return lines.join("\n");
}

export const SUGGESTION_SYSTEM_PROMPT = `You write the four suggestion chips shown on the empty state of an agent that searches the user's local coding-agent session history (their own past Claude Code / Codex / Gemini conversations).

You will receive a digest of their recent activity. Produce EXACTLY four chips, one per category:
- "recap"      — a time-scoped "what happened" question (yesterday / this week)
- "find"       — locate specific past sessions about a concrete thing they worked on
- "synthesize" — a cross-session summary or comparison
- "handoff"    — draft a context-pack prompt to continue their current work in a fresh agent session

Rules:
- Write in the user's first-person voice, as something they would click ("What did I…", "Find…", "Draft a prompt…").
- Anchor chips in CONCRETE topics from the session titles and summaries — the feature, bug, or artifact itself ("the usage daemon fix", "the onboarding wizard"), not just repository names. A project name may appear in at most two of the four labels; a label with a topic and no project name is often better.
- Use project display names exactly as given in the digest.
- Specific and tempting beats generic. ≤ 90 characters per label.
- Output ONLY a JSON array: [{"label": "...", "category": "recap|find|synthesize|handoff"}, ...] — no prose, no markdown fence.`;

const suggestionSchema = z
  .array(
    z.object({
      label: z.string().min(1),
      category: z.enum(["recap", "find", "synthesize", "handoff"]),
    }),
  )
  .length(4);

/** Pull the first JSON array out of the response — smaller models wrap it
 *  in preambles and fences no matter what the prompt says — then validate.
 *  Returns null on any mismatch; callers fall back to deterministic. */
export function parseSuggestions(content: string): Suggestion[] | null {
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  try {
    const result = suggestionSchema.safeParse(JSON.parse(content.slice(start, end + 1)));
    if (!result.success) return null;
    return result.data.map((s) => ({ ...s, label: s.label.slice(0, LABEL_MAX) }));
  } catch {
    return null;
  }
}

import { getAnySession } from "@claude-lens/parser/fs";
import { summarizeSessionForAI } from "@/lib/ai/session-summary";
import { ensureIndex, indexStats } from "./index-store";
import { searchDocs } from "./search";
import type { McpToolDef, McpTools } from "./mcp";
import type { SearchFilters } from "./types";

const FULL_TEXT_MAX = 48_000;

const DEFS: McpToolDef[] = [
  {
    name: "search_sessions",
    description:
      "Full-text search across every locally recorded coding-agent session (Claude Code, Codex, Gemini, …). " +
      "Searches what the user and the agent actually said, plus AI-written session summaries. " +
      "Multi-word queries are ranked-OR (sessions matching all words rank first); wrap a phrase in double quotes for exact match. " +
      "Returns ranked hits with snippets and a dashboard url per session. " +
      "Run several differently-worded searches when the first one isn't conclusive.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms. Quote phrases for exact match." },
        project: { type: "string", description: "Exact canonical project path filter, e.g. /Users/me/Repo/foo" },
        agent: { type: "string", description: "Agent source filter: claude-code | codex | gemini-cli | …" },
        after: { type: "string", description: "Only sessions starting on/after this local day (YYYY-MM-DD)" },
        before: { type: "string", description: "Only sessions starting on/before this local day (YYYY-MM-DD)" },
        limit: { type: "number", description: "Max hits to return (default 10, max 25)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_session",
    description:
      "Fetch one session by id. mode=summary (default) returns a compact structured digest: metadata, first user message, " +
      "turn-by-turn timeline, PRs shipped, errors, final message. mode=full_text returns the raw conversational text " +
      "(user + agent messages, capped). Use summary first; full_text only when you need exact wording.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        mode: { type: "string", enum: ["summary", "full_text"] },
      },
      required: ["session_id"],
    },
  },
  {
    name: "list_sessions",
    description:
      "List recent sessions (newest first) with title, project, day, and agent. " +
      "Use for time- or project-scoped questions like 'what did I work on last Tuesday' — filter with after/before/project.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Exact canonical project path filter" },
        agent: { type: "string" },
        after: { type: "string", description: "YYYY-MM-DD inclusive" },
        before: { type: "string", description: "YYYY-MM-DD inclusive" },
        limit: { type: "number", description: "Default 20, max 100" },
      },
    },
  },
  {
    name: "list_projects",
    description: "List every project that has recorded sessions, with session counts and the most recent activity day.",
    inputSchema: { type: "object", properties: {} },
  },
];

type SearchArgs = SearchFilters & { query: string; limit?: number };
type GetArgs = { session_id: string; mode?: "summary" | "full_text" };
type ListArgs = SearchFilters & { limit?: number };

async function searchSessions(args: SearchArgs): Promise<string> {
  const docs = await ensureIndex();
  const limit = Math.min(Math.max(1, args.limit ?? 10), 25);
  const { hits, total } = searchDocs(docs, args.query, {
    limit,
    filters: { project: args.project, agent: args.agent, after: args.after, before: args.before },
  });
  return JSON.stringify({
    indexed_sessions: indexStats().sessions,
    total_matches: total,
    hits: hits.map((h) => ({
      session_id: h.sessionId,
      url: `/sessions/${h.sessionId}`,
      agent: h.agent,
      project: h.project,
      day: h.day,
      title: h.title,
      matched_terms: h.matchedTerms,
      snippets: h.snippets,
    })),
  });
}

async function getSessionTool(args: GetArgs): Promise<string> {
  const docs = await ensureIndex();
  const doc = docs.find((d) => d.sessionId === args.session_id);
  if (args.mode === "full_text") {
    if (!doc) throw new Error(`session not found in index: ${args.session_id}`);
    let out = `# Session ${doc.sessionId}\nproject: ${doc.project}\nday: ${doc.day}\nagent: ${doc.agent}\n\n`;
    for (const c of doc.chunks) {
      const line = `[${c.role}] ${c.text}\n\n`;
      if (out.length + line.length > FULL_TEXT_MAX) {
        out += "…(truncated)";
        break;
      }
      out += line;
    }
    return out;
  }
  const detail = await getAnySession(args.session_id);
  if (!detail) throw new Error(`session not found: ${args.session_id}`);
  const summaries = doc?.chunks.filter((c) => c.role === "summary").map((c) => c.text) ?? [];
  const header = summaries.length ? `## AI summary\n${summaries.join("\n")}\n\n` : "";
  return header + summarizeSessionForAI(detail);
}

async function listSessions(args: ListArgs): Promise<string> {
  const docs = await ensureIndex();
  const limit = Math.min(Math.max(1, args.limit ?? 20), 100);
  const filtered = docs
    .filter(
      (d) =>
        (!args.project || d.project === args.project) &&
        (!args.agent || d.agent === args.agent) &&
        (!args.after || d.day >= args.after) &&
        (!args.before || d.day <= args.before),
    )
    .sort((a, b) => (b.startIso ?? "").localeCompare(a.startIso ?? ""));
  return JSON.stringify({
    total: filtered.length,
    sessions: filtered.slice(0, limit).map((d) => ({
      session_id: d.sessionId,
      url: `/sessions/${d.sessionId}`,
      agent: d.agent,
      project: d.project,
      day: d.day,
      title: d.title,
    })),
  });
}

async function listProjects(): Promise<string> {
  const docs = await ensureIndex();
  const byProject = new Map<string, { sessions: number; lastDay: string }>();
  for (const d of docs) {
    const cur = byProject.get(d.project) ?? { sessions: 0, lastDay: "" };
    cur.sessions++;
    if (d.day > cur.lastDay) cur.lastDay = d.day;
    byProject.set(d.project, cur);
  }
  const projects = Array.from(byProject.entries())
    .map(([project, v]) => ({ project, ...v }))
    .sort((a, b) => b.lastDay.localeCompare(a.lastDay));
  return JSON.stringify({ projects });
}

export const agentTools: McpTools = {
  defs: DEFS,
  call: async (name, args) => {
    switch (name) {
      case "search_sessions":
        return searchSessions(args as SearchArgs);
      case "get_session":
        return getSessionTool(args as GetArgs);
      case "list_sessions":
        return listSessions(args as ListArgs);
      case "list_projects":
        return listProjects();
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  },
};

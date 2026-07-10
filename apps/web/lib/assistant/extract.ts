import { canonicalProjectName, toLocalDay, type SessionDetail } from "@claude-lens/parser";
import { INDEX_VERSION, type IndexChunk, type IndexDoc } from "./types";

const CHUNK_MAX = 4000;
const DOC_TEXT_MAX = 300_000;
const TITLE_MAX = 120;

/** Harness-injected user events that aren't real human input. */
const SKIP_PREFIXES = [
  "<command-name>",
  "<local-command",
  "Base directory for this skill:",
  "<task-notification>",
  "[SYSTEM NOTIFICATION",
  "Caveat: the messages below",
];

function cleanText(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trimEnd();
}

/** Extract the searchable conversational text of one session. Tool calls,
 *  tool results, and thinking are deliberately excluded — search should find
 *  what was said, not every file path a tool ever printed. */
export function extractIndexDoc(
  session: SessionDetail,
  file: { mtimeMs: number; sizeBytes: number },
): IndexDoc {
  const chunks: IndexChunk[] = [];
  let totalChars = 0;
  let truncated = false;

  for (const e of session.events) {
    if (e.role !== "user" && e.role !== "agent") continue;
    if (e.role === "user" && e.teammateMessage) continue;
    for (const b of e.blocks) {
      if (b.type !== "text" || typeof b.text !== "string") continue;
      if (SKIP_PREFIXES.some((p) => b.text.startsWith(p))) continue;
      let text = cleanText(b.text);
      if (!text.trim()) continue;
      if (text.length > CHUNK_MAX) {
        text = text.slice(0, CHUNK_MAX);
        truncated = true;
      }
      if (totalChars + text.length > DOC_TEXT_MAX) {
        truncated = true;
        break;
      }
      totalChars += text.length;
      chunks.push({ role: e.role, text, idx: e.index });
    }
    if (totalChars >= DOC_TEXT_MAX) break;
  }

  const firstUser = chunks.find((c) => c.role === "user");
  const rawTitle = session.firstUserPreview?.trim() || firstUser?.text.trim() || "(untitled session)";
  const title = rawTitle.replace(/\s+/g, " ").slice(0, TITLE_MAX);

  const startMs = session.firstTimestamp ? Date.parse(session.firstTimestamp) : NaN;

  return {
    version: INDEX_VERSION,
    sessionId: session.id,
    agent: session.agent ?? "claude-code",
    project: canonicalProjectName(session.projectName),
    day: Number.isNaN(startMs) ? "" : toLocalDay(startMs),
    startIso: session.firstTimestamp,
    endIso: session.lastTimestamp,
    title,
    chunks,
    ...(truncated ? { truncated } : {}),
    mtimeMs: file.mtimeMs,
    sizeBytes: file.sizeBytes,
  };
}

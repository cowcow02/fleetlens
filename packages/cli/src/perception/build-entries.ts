import { statSync } from "node:fs";
import { basename, dirname } from "node:path";
import { parseTranscript } from "@claude-lens/parser";
import type { SessionDetail } from "@claude-lens/parser";
import { jsonlFileTooLarge, readJsonlFile, readJsonlFileSync } from "@claude-lens/parser/fs";
import { buildEntries } from "@claude-lens/entries";
import type { Entry } from "@claude-lens/entries";

/**
 * Decode a URL-encoded Claude Code project directory name into a human-readable path.
 * Claude Code encodes cwd by replacing "/" with "-"; the leading "-" represents the
 * leading "/". Example: `-Users-alice-Repo-foo` → `/Users/alice/Repo/foo`.
 */
export function decodeProjectDirName(projectDir: string): string {
  if (projectDir.startsWith("-")) {
    return "/" + projectDir.slice(1).replace(/-/g, "/");
  }
  return projectDir.replace(/-/g, "/");
}

/**
 * Parse a Claude Code session JSONL into deterministic Entries (no LLM),
 * reconstructing `SessionDetail` BYTE-IDENTICALLY to the perception sweep's
 * claude-code branch so the `(session_id, local_day)` keys match exactly and a
 * later sweep preserves rather than duplicates. CLAUDE-CODE ONLY — callers gate
 * on `(s.agent ?? "claude-code") === "claude-code"`.
 *
 * Return contract drives the sweep's checkpointing: `null` = blank/unreadable
 * (nothing parsed → caller must NOT advance the byte checkpoint); `[]` = parsed
 * but zero entries (caller SHOULD checkpoint so it isn't re-parsed every tick).
 * Throws on missing/unreadable bytes — callers catch and fall through.
 */
export function buildEntriesForFile(filePath: string): Entry[] | null {
  const stat = statSync(filePath);
  // Oversized → [] so the sweep checkpoints and does not retry every 5 min.
  // (null would skip the checkpoint and re-parse next tick.)
  if (jsonlFileTooLarge(stat.size)) return [];
  return entriesFromLines(filePath, stat.size, readJsonlFileSync(filePath));
}

/** Same contract as buildEntriesForFile; the streaming read yields to the
 *  event loop so the daemon's 5 s watchdog tick is not starved by one file.
 *  team/push.ts keeps the sync variant — its payload builders are sync. */
export async function buildEntriesForFileAsync(filePath: string): Promise<Entry[] | null> {
  const stat = statSync(filePath);
  if (jsonlFileTooLarge(stat.size)) return [];
  return entriesFromLines(filePath, stat.size, await readJsonlFile(filePath));
}

function entriesFromLines(filePath: string, sizeBytes: number, rawLines: unknown[]): Entry[] | null {
  if (rawLines.length === 0) return null;

  const { meta, events } = parseTranscript(rawLines);
  const fileName = basename(filePath);
  const projectDir = basename(dirname(filePath));
  const sessionId = fileName.replace(/\.jsonl$/, "");

  const sd: SessionDetail = {
    ...meta,
    id: sessionId,
    filePath,
    projectDir,
    projectName: meta.cwd ?? decodeProjectDirName(projectDir),
    events,
  };

  const built = buildEntries(sd);
  for (const e of built) {
    // Stamp real byte_offset so enrichment readers have accurate provenance.
    e.source_checkpoint.byte_offset = sizeBytes;
  }
  return built;
}

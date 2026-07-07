import { statSync, readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { parseTranscript } from "@claude-lens/parser";
import type { SessionDetail } from "@claude-lens/parser";
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
 * Parse a single Claude Code session JSONL file and build its deterministic
 * Entries (no LLM). The `SessionDetail` is reconstructed BYTE-IDENTICALLY to
 * the perception sweep's claude-code branch (basename → session id,
 * `parseTranscript` on raw lines, `meta.cwd ?? decodeProjectDirName`), so the
 * `(session_id, local_day)` keys `buildEntries` derives match exactly — a
 * later sweep then preserves rather than duplicates. `source_checkpoint`
 * carries the file's byte size for provenance.
 *
 * CLAUDE-CODE ONLY: the sweep processes non-claude sources through a different
 * path (`source.getSession(id)` keyed by the source's own id, NOT the
 * basename). Feeding a codex/gemini transcript here would either throw on the
 * foreign format or write an entry under a mismatched key. Callers must gate
 * on `(s.agent ?? "claude-code") === "claude-code"`.
 *
 * Returns `[]` for an empty/blank transcript. Throws (missing file, unreadable
 * bytes) — callers should catch and fall through to base-only rollups.
 */
export function buildEntriesForFile(filePath: string): Entry[] {
  const stat = statSync(filePath);
  const raw = readFileSync(filePath, "utf8");
  const rawLines: unknown[] = raw
    .split("\n")
    .filter(Boolean)
    .map(l => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter((x): x is object => x !== null);

  if (rawLines.length === 0) return [];

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
    e.source_checkpoint.byte_offset = stat.size;
  }
  return built;
}

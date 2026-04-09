/**
 * Server-side filesystem scanner for Claude Code JSONL transcripts.
 *
 * Lives in its own subpath (`@claude-sessions/parser/fs`) so that pure
 * browser consumers can use the rest of the package without importing
 * node:fs.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseTranscript } from "./parser.js";
import type { SessionDetail, SessionMeta } from "./types.js";

export const DEFAULT_ROOT = path.join(os.homedir(), ".claude", "projects");

/** Claude Code encodes cwd as `-Users-me-Repo-foo`. Decode → `/Users/me/Repo/foo`. */
export function decodeProjectName(dir: string): string {
  if (!dir.startsWith("-")) return dir;
  return "/" + dir.slice(1).replace(/-/g, "/");
}

/** Parse a JSONL file into one raw object per line, skipping malformed lines. */
export async function readJsonlFile(filePath: string): Promise<unknown[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const out: unknown[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines rather than failing the whole session.
    }
  }
  return out;
}

export type FileRef = {
  projectDir: string;
  fileName: string;
  fullPath: string;
  mtimeMs: number;
  sizeBytes: number;
};

/**
 * Walk `~/.claude/projects/<encoded-cwd>/*.jsonl`, returning one ref per file
 * with mtime + size stats. Fast (fs.stat only).
 */
export async function walkJsonlFiles(root: string = DEFAULT_ROOT): Promise<FileRef[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }

  const refs: FileRef[] = [];
  for (const projectDir of entries) {
    const projectPath = path.join(root, projectDir);
    let stat;
    try {
      stat = await fs.stat(projectPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    let files: string[] = [];
    try {
      files = await fs.readdir(projectPath);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const fullPath = path.join(projectPath, f);
      try {
        const fileStat = await fs.stat(fullPath);
        refs.push({
          projectDir,
          fileName: f,
          fullPath,
          mtimeMs: fileStat.mtimeMs,
          sizeBytes: fileStat.size,
        });
      } catch {
        // skip
      }
    }
  }
  return refs;
}

export function sessionIdFromFileName(fileName: string): string {
  return fileName.replace(/\.jsonl$/i, "");
}

export type ListOptions = {
  /** Override the ~/.claude/projects root */
  root?: string;
  /** Max number of sessions to return. Sorted newest-first by mtime. */
  limit?: number;
  /** Only include sessions with this projectDir prefix (filters by cwd) */
  projectDir?: string;
};

/** List parsed session metadata, sorted newest-first by file mtime. */
export async function listSessions(opts: ListOptions = {}): Promise<SessionMeta[]> {
  const { root = DEFAULT_ROOT, limit = 500, projectDir } = opts;
  let files = await walkJsonlFiles(root);
  if (projectDir) files = files.filter((f) => f.projectDir === projectDir);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const sliced = files.slice(0, limit);

  const metas: SessionMeta[] = [];
  for (const f of sliced) {
    try {
      const rawLines = await readJsonlFile(f.fullPath);
      const { meta } = parseTranscript(rawLines);
      metas.push({
        ...meta,
        id: sessionIdFromFileName(f.fileName),
        filePath: f.fullPath,
        projectDir: f.projectDir,
        projectName: decodeProjectName(f.projectDir),
      });
    } catch {
      // skip unreadable files
    }
  }
  return metas;
}

/** Load a single session by id. Returns null if not found. */
export async function getSession(
  id: string,
  opts: { root?: string } = {},
): Promise<SessionDetail | null> {
  const { root = DEFAULT_ROOT } = opts;
  const files = await walkJsonlFiles(root);
  const hit = files.find((f) => sessionIdFromFileName(f.fileName) === id);
  if (!hit) return null;

  const rawLines = await readJsonlFile(hit.fullPath);
  const { meta, events } = parseTranscript(rawLines);
  return {
    ...meta,
    id,
    filePath: hit.fullPath,
    projectDir: hit.projectDir,
    projectName: decodeProjectName(hit.projectDir),
    events,
  };
}

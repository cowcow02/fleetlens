/**
 * Cowork (Claude Desktop "local agent mode") transcript reader.
 *
 * Cowork stores per-session state in the Claude Desktop user-data dir:
 *   macOS:   ~/Library/Application Support/Claude/local-agent-mode-sessions/
 *   Linux:   ~/.config/Claude/local-agent-mode-sessions/
 *   Windows: %APPDATA%/Claude/local-agent-mode-sessions/
 * Inside each: <accountId>/<workspaceId>/ holds one `local_<uuid>.json` (the
 * top-level session metadata) and a sibling `local_<uuid>/` directory whose
 * `audit.jsonl` is the conversation transcript. The audit log uses Claude
 * Code's JSONL shape (user / assistant / system / attachment / …) plus a few
 * cowork-only event types that already fall through `parseTranscript` as
 * meta. Same workspace also holds `spaces.json`: cowork's Spaces feature,
 * mapping `spaceId → folders[].path`, which is how a session resolves to a
 * real user-facing project path on disk.
 *
 * Sibling dir `claude-code-sessions/<accountId>/<workspaceId>/local_*.json`
 * holds Claude Code sessions launched from inside the Desktop app — same
 * shape as this one but a different lineage. Defer to a future agent: add
 * a parallel adapter or extend this one once the rollup story is decided.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { canonicalProjectName, toLocalDay } from "./analytics.js";
import { parseTranscript } from "./parser.js";
import type { SessionDetail, SessionMeta } from "./types.js";

export const DEFAULT_COWORK_ROOT = defaultCoworkRoot();

function defaultCoworkRoot(): string {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Claude", "local-agent-mode-sessions");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return path.join(appData, "Claude", "local-agent-mode-sessions");
  }
  return path.join(home, ".config", "Claude", "local-agent-mode-sessions");
}

const SESSION_ID_RE = /^local_[0-9a-f-]+$/;

type SessionFile = {
  /** Outer `local_<uuid>` slug — the user-facing session id. */
  sessionId: string;
  /** Absolute path to the `audit.jsonl` transcript. */
  auditPath: string;
  /** Absolute path to the sibling `local_<uuid>.json` metadata file. */
  metaPath: string;
  /** Workspace directory (contains `spaces.json`). */
  workspaceDir: string;
  /** mtime/size of the audit file — drives the cache. */
  mtimeMs: number;
  sizeBytes: number;
};

async function safeReaddir(p: string): Promise<string[]> {
  return fs.readdir(p).catch(() => [] as string[]);
}

async function listSessionFiles(root: string): Promise<SessionFile[]> {
  const out: SessionFile[] = [];
  const accounts = await safeReaddir(root);
  for (const accountId of accounts) {
    const accountDir = path.join(root, accountId);
    const workspaces = await safeReaddir(accountDir);
    for (const workspaceId of workspaces) {
      const workspaceDir = path.join(accountDir, workspaceId);
      const entries = await safeReaddir(workspaceDir);
      for (const entry of entries) {
        if (!SESSION_ID_RE.test(entry)) continue;
        const sessionDir = path.join(workspaceDir, entry);
        const auditPath = path.join(sessionDir, "audit.jsonl");
        const stat = await fs.stat(auditPath).catch(() => null);
        if (!stat || !stat.isFile() || stat.size === 0) continue;
        out.push({
          sessionId: entry,
          auditPath,
          metaPath: path.join(workspaceDir, `${entry}.json`),
          workspaceDir,
          mtimeMs: stat.mtimeMs,
          sizeBytes: stat.size,
        });
      }
    }
  }
  return out;
}

/* ================================================================= */
/*  spaces.json → spaceId → project path                             */
/* ================================================================= */

type SpacesCacheEntry = { mtimeMs: number; spaceIdToPath: Map<string, string> };
const spacesCache = new Map<string, SpacesCacheEntry>();

async function loadSpacesForWorkspace(workspaceDir: string): Promise<Map<string, string>> {
  const spacesPath = path.join(workspaceDir, "spaces.json");
  const stat = await fs.stat(spacesPath).catch(() => null);
  if (!stat) return new Map();
  const cached = spacesCache.get(workspaceDir);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.spaceIdToPath;
  const raw = await fs.readFile(spacesPath, "utf8").catch(() => "");
  const out = new Map<string, string>();
  try {
    const parsed = JSON.parse(raw) as { spaces?: Array<Record<string, unknown>> };
    for (const space of parsed.spaces ?? []) {
      const id = typeof space.id === "string" ? space.id : undefined;
      const folders = Array.isArray(space.folders) ? space.folders : [];
      const first = folders[0] as { path?: unknown } | undefined;
      const folderPath = typeof first?.path === "string" ? first.path : undefined;
      if (id && folderPath) out.set(id, folderPath);
    }
  } catch {
    // Skip malformed spaces.json — sessions fall back to userSelectedFolders.
  }
  spacesCache.set(workspaceDir, { mtimeMs: stat.mtimeMs, spaceIdToPath: out });
  return out;
}

/* ================================================================= */
/*  Per-session metadata                                             */
/* ================================================================= */

type CoworkMeta = {
  spaceId?: string;
  userSelectedFolders?: string[];
  cwd?: string;
  model?: string;
  title?: string;
  createdAt?: number;
  lastActivityAt?: number;
};

async function readCoworkMeta(metaPath: string): Promise<CoworkMeta> {
  const raw = await fs.readFile(metaPath, "utf8").catch(() => "");
  if (!raw) return {};
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    return {
      spaceId: typeof j.spaceId === "string" ? j.spaceId : undefined,
      userSelectedFolders: Array.isArray(j.userSelectedFolders)
        ? (j.userSelectedFolders.filter((s) => typeof s === "string") as string[])
        : undefined,
      cwd: typeof j.cwd === "string" ? j.cwd : undefined,
      model: typeof j.model === "string" ? j.model : undefined,
      title: typeof j.title === "string" ? j.title : undefined,
      createdAt: typeof j.createdAt === "number" ? j.createdAt : undefined,
      lastActivityAt: typeof j.lastActivityAt === "number" ? j.lastActivityAt : undefined,
    };
  } catch {
    return {};
  }
}

/** Resolve the user-facing project path for a cowork session. spaceId
 *  trumps userSelectedFolders because a session can run inside a folder
 *  the user picked ad-hoc; the Space is the durable grouping that the
 *  UI also uses. */
function resolveProject(
  meta: CoworkMeta,
  spaceIdToPath: Map<string, string>,
): { projectName: string; projectDir: string; cwd?: string } {
  let projectPath: string | undefined;
  if (meta.spaceId) projectPath = spaceIdToPath.get(meta.spaceId);
  if (!projectPath && meta.userSelectedFolders && meta.userSelectedFolders.length > 0) {
    projectPath = meta.userSelectedFolders[0];
  }
  if (!projectPath) {
    return { projectName: "cowork:unspaced", projectDir: "cowork-unspaced" };
  }
  return {
    projectName: canonicalProjectName(projectPath),
    projectDir: projectPath.replace(/^\//, "-").replace(/\//g, "-"),
    cwd: projectPath,
  };
}

/* ================================================================= */
/*  Read + parse                                                     */
/* ================================================================= */

async function readJsonl(filePath: string): Promise<unknown[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const out: unknown[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines.
    }
  }
  return out;
}

type Parsed = { meta: SessionMeta; events: SessionDetail["events"] };

async function parseCoworkSession(file: SessionFile): Promise<Parsed> {
  const [lines, coworkMeta, spaceIdToPath] = await Promise.all([
    readJsonl(file.auditPath),
    readCoworkMeta(file.metaPath),
    loadSpacesForWorkspace(file.workspaceDir),
  ]);
  const { meta: baseMeta, events } = parseTranscript(lines);
  const { projectName, projectDir, cwd } = resolveProject(coworkMeta, spaceIdToPath);

  // The audit JSONL never carries a real cwd — its `cwd` field is the VM
  // path (`/sessions/<vmProcessName>`). Prefer the resolved space path.
  const meta: SessionMeta = {
    ...baseMeta,
    agent: "cowork",
    id: file.sessionId,
    sessionId: file.sessionId,
    filePath: file.auditPath,
    projectName,
    projectDir,
    cwd: cwd ?? baseMeta.cwd,
    model: baseMeta.model ?? coworkMeta.model,
  };
  return { meta, events };
}

/* ================================================================= */
/*  Caching                                                          */
/* ================================================================= */

type MetaEntry = { meta: SessionMeta; mtimeMs: number; sizeBytes: number };
type DetailEntry = { detail: SessionDetail; mtimeMs: number; sizeBytes: number };
const metaCache = new Map<string, MetaEntry>();
const detailCache = new Map<string, DetailEntry>();

export function clearCoworkCaches(): void {
  metaCache.clear();
  detailCache.clear();
  spacesCache.clear();
}

export type ListCoworkOptions = { root?: string; limit?: number };

export async function listCoworkSessions(
  opts: ListCoworkOptions = {},
): Promise<SessionMeta[]> {
  const root = opts.root ?? DEFAULT_COWORK_ROOT;
  const files = await listSessionFiles(root);
  const out: SessionMeta[] = [];
  for (const file of files) {
    const cached = metaCache.get(file.auditPath);
    if (cached && cached.mtimeMs === file.mtimeMs && cached.sizeBytes === file.sizeBytes) {
      out.push(cached.meta);
      continue;
    }
    try {
      const { meta } = await parseCoworkSession(file);
      metaCache.set(file.auditPath, {
        meta,
        mtimeMs: file.mtimeMs,
        sizeBytes: file.sizeBytes,
      });
      out.push(meta);
    } catch {
      // Skip files that fail to parse — keep listing the rest.
    }
  }
  out.sort((a, b) => (b.firstTimestamp ?? "").localeCompare(a.firstTimestamp ?? ""));
  if (opts.limit !== undefined) return out.slice(0, opts.limit);
  return out;
}

export type GetCoworkOptions = { root?: string };

export async function getCoworkSession(
  id: string,
  opts: GetCoworkOptions = {},
): Promise<SessionDetail | null> {
  const root = opts.root ?? DEFAULT_COWORK_ROOT;
  const files = await listSessionFiles(root);
  const file = files.find((f) => f.sessionId === id);
  if (!file) return null;
  const cached = detailCache.get(file.auditPath);
  if (cached && cached.mtimeMs === file.mtimeMs && cached.sizeBytes === file.sizeBytes) {
    return cached.detail;
  }
  const { meta, events } = await parseCoworkSession(file);
  const detail: SessionDetail = { ...meta, events };
  detailCache.set(file.auditPath, {
    detail,
    mtimeMs: file.mtimeMs,
    sizeBytes: file.sizeBytes,
  });
  return detail;
}

export function coworkSessionLocalDay(meta: SessionMeta): string | undefined {
  if (!meta.firstTimestamp) return undefined;
  const ms = Date.parse(meta.firstTimestamp);
  return Number.isFinite(ms) ? toLocalDay(ms) : undefined;
}

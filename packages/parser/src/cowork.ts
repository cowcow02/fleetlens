/**
 * Cowork (Claude Desktop "local agent mode") transcript reader.
 *
 * Read from `audit.jsonl` rather than the per-session
 * `.claude/projects/<encoded>/<cliSessionId>.jsonl` mirror: the audit log
 * is at a fixed path and covers every session, including the few that
 * errored before the inner JSONL was written. Sessions resolve to a
 * user-facing project path via the sibling `spaces.json` (cowork's Spaces
 * feature) — the in-session `cwd` is the VM-internal `/sessions/<name>`
 * path and is not user-meaningful.
 *
 * `claude-code-sessions/<accountId>/<workspaceId>/` is the same shape
 * but holds Claude Code sessions launched from inside Desktop — out of
 * scope here; a future agent can extend or fork this adapter.
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
  auditPath: string;
  metaPath: string;
  /** Workspace directory (contains `spaces.json`). */
  workspaceDir: string;
  auditMtimeMs: number;
  auditSize: number;
  /** mtime of `local_<uuid>.json` — Desktop rewrites it when the user
   *  attaches a folder, links a Space, or finishes a turn (lastActivityAt).
   *  Folded into the cache key so a sidecar-only edit invalidates the
   *  cached `projectName`/`cwd`/model. 0 when the sidecar is missing. */
  metaMtimeMs: number;
  /** mtime of the workspace's `spaces.json` — same invalidation story for
   *  folder renames or space deletions. 0 when missing. */
  spacesMtimeMs: number;
};

async function safeReaddir(p: string): Promise<string[]> {
  return fs.readdir(p).catch(() => [] as string[]);
}

async function statMs(p: string): Promise<number> {
  const s = await fs.stat(p).catch(() => null);
  return s ? s.mtimeMs : 0;
}

async function listSessionFiles(root: string): Promise<SessionFile[]> {
  const out: SessionFile[] = [];
  const accounts = await safeReaddir(root);
  for (const accountId of accounts) {
    const accountDir = path.join(root, accountId);
    const workspaces = await safeReaddir(accountDir);
    for (const workspaceId of workspaces) {
      const workspaceDir = path.join(accountDir, workspaceId);
      const spacesMtimeMs = await statMs(path.join(workspaceDir, "spaces.json"));
      const entries = await safeReaddir(workspaceDir);
      for (const entry of entries) {
        if (!SESSION_ID_RE.test(entry)) continue;
        const auditPath = path.join(workspaceDir, entry, "audit.jsonl");
        const auditStat = await fs.stat(auditPath).catch(() => null);
        if (!auditStat || !auditStat.isFile() || auditStat.size === 0) continue;
        const metaPath = path.join(workspaceDir, `${entry}.json`);
        const metaMtimeMs = await statMs(metaPath);
        out.push({
          sessionId: entry,
          auditPath,
          metaPath,
          workspaceDir,
          auditMtimeMs: auditStat.mtimeMs,
          auditSize: auditStat.size,
          metaMtimeMs,
          spacesMtimeMs,
        });
      }
    }
  }
  return out;
}

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

/** spaceId trumps userSelectedFolders: a session can run inside a folder
 *  the user picked ad-hoc, but the Space is the durable grouping that
 *  the Desktop UI also uses. */
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

/** Cowork's audit.jsonl logs each user message twice under the SAME `uuid`: the
 *  raw desktop input (no `timestamp`) and an `isReplay` copy fed into the agent
 *  runtime (carrying a real `timestamp` and a fresh inner `session_id`).
 *  parseTranscript would emit both, doubling every user turn in the transcript.
 *  Keep one line per uuid — prefer the copy that has a `timestamp` so the event
 *  still lands on the timeline. Lines without a uuid (system/result/rate-limit)
 *  pass through untouched. */
function dedupeReplayedLines(lines: unknown[]): unknown[] {
  const keepAt = new Map<string, number>();
  lines.forEach((line, i) => {
    const rec = line as { uuid?: unknown; timestamp?: unknown };
    if (typeof rec.uuid !== "string") return;
    const prev = keepAt.get(rec.uuid);
    if (prev === undefined) {
      keepAt.set(rec.uuid, i);
      return;
    }
    const prevHasTs = (lines[prev] as { timestamp?: unknown }).timestamp !== undefined;
    if (!prevHasTs && rec.timestamp !== undefined) keepAt.set(rec.uuid, i);
  });
  return lines.filter((line, i) => {
    const rec = line as { uuid?: unknown };
    return typeof rec.uuid !== "string" || keepAt.get(rec.uuid) === i;
  });
}

type Parsed = { meta: SessionMeta; events: SessionDetail["events"] };

async function parseCoworkSession(file: SessionFile): Promise<Parsed> {
  const [lines, coworkMeta, spaceIdToPath] = await Promise.all([
    readJsonl(file.auditPath),
    readCoworkMeta(file.metaPath),
    loadSpacesForWorkspace(file.workspaceDir),
  ]);
  const { meta: baseMeta, events } = parseTranscript(dedupeReplayedLines(lines));
  const { projectName, projectDir, cwd } = resolveProject(coworkMeta, spaceIdToPath);

  // The audit JSONL's `cwd` field is the VM path (`/sessions/<vmProcessName>`)
  // and is never user-meaningful — prefer the resolved Space path.
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

type CacheKey = {
  auditMtimeMs: number;
  auditSize: number;
  metaMtimeMs: number;
  spacesMtimeMs: number;
};

function cacheKeyFor(file: SessionFile): CacheKey {
  return {
    auditMtimeMs: file.auditMtimeMs,
    auditSize: file.auditSize,
    metaMtimeMs: file.metaMtimeMs,
    spacesMtimeMs: file.spacesMtimeMs,
  };
}

function cacheKeyMatches(a: CacheKey, b: CacheKey): boolean {
  return (
    a.auditMtimeMs === b.auditMtimeMs &&
    a.auditSize === b.auditSize &&
    a.metaMtimeMs === b.metaMtimeMs &&
    a.spacesMtimeMs === b.spacesMtimeMs
  );
}

type MetaEntry = { meta: SessionMeta; key: CacheKey };
type DetailEntry = { detail: SessionDetail; key: CacheKey };
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
    const key = cacheKeyFor(file);
    const cached = metaCache.get(file.auditPath);
    if (cached && cacheKeyMatches(cached.key, key)) {
      out.push(cached.meta);
      continue;
    }
    try {
      const { meta } = await parseCoworkSession(file);
      metaCache.set(file.auditPath, { meta, key });
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
  const key = cacheKeyFor(file);
  const cached = detailCache.get(file.auditPath);
  if (cached && cacheKeyMatches(cached.key, key)) return cached.detail;
  const { meta, events } = await parseCoworkSession(file);
  const detail: SessionDetail = { ...meta, events };
  detailCache.set(file.auditPath, { detail, key });
  return detail;
}

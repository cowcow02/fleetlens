/**
 * Runtime = "one machine running fleetlens".
 *
 * Each fleet member exposes a RuntimeInfo summarizing what's on its local
 * disk: which agent sources have data, how many sessions in the last 24h
 * and 7 days, total agent time, recent projects. This is the data plane
 * surfaced to /runtimes in the dashboard.
 *
 * Privacy boundary: we expose counts + project names + timestamps, NOT
 * raw transcripts or message previews. Peers can see "you ran 47 Claude
 * Code sessions today against `kipwise` and `fleetlens`" but not the
 * conversations inside.
 */

import { hostname } from "node:os";
import { agentSources, type AgentSource } from "@claude-lens/parser/fs";
import {
  canonicalProjectName,
  dailyActivity,
  type DailyBucket,
} from "@claude-lens/parser/analytics";
import type { SessionMeta, AgentKind } from "@claude-lens/parser";

/**
 * Bumped from 1 → 2 when we added `sessions` to the wire payload. v1 peers
 * still answer getInfo with the old shape (no sessions field); v2 receivers
 * default sessions to [] when missing, which means the merge layer just
 * shows v1 peers as "no remote sessions visible" without breaking anything.
 */
export const RUNTIME_INFO_PROTOCOL_VERSION = 2;

/** Max sessions per peer we put on the wire each refresh. Caps payload at
 *  roughly 200 * ~1.5 KB = 300 KB per peer per minute. The dashboard never
 *  shows more than ~50 rows on a page anyway. */
export const REMOTE_SESSIONS_CAP = 200;

export type RuntimeProjectSummary = {
  name: string;
  sessionCount: number;
  lastActivityAt: string;
  agentTimeMs: number;
};

export type RuntimeAgentSourceSummary = {
  kind: AgentKind;
  totalSessions: number;
  /** Sessions whose lastTimestamp falls within the last 24h. */
  sessionsLast24h: number;
};

export type RuntimeStats = {
  totalSessions: number;
  sessionsLast24h: number;
  sessionsLast7d: number;
  agentTimeLast24hMs: number;
  agentTimeLast7dMs: number;
  /** ISO timestamp of the most recent event across all agents. */
  lastActivityAt?: string;
};

/**
 * Per-session payload shared over the wire. A near-full SessionMeta —
 * we strip `filePath` because the source machine's local path is
 * meaningless on the receiver, but keep the preview fields
 * (firstUserPreview / lastUserPreview / lastAgentPreview) so list cards
 * render the same way for remote sessions as local ones. Since
 * getSessionDetail already streams the full transcript on demand,
 * stripping a one-line preview was inconsistent — visible blank cards
 * with viewable detail inside.
 */
export type WireSessionMeta = Omit<SessionMeta, "filePath">;

export type RuntimeInfo = {
  /** Wire-format version so we can evolve the payload without bricking peers. */
  protocol: number;
  /** Short device id (e.g. "VR1C-N2VA-YPPG"). "local" for the self-runtime. */
  deviceId: string;
  /** Fleetlens-assigned 32-byte public key in hex. Empty for the local runtime. */
  publicKey: string;
  isLocal: boolean;
  label?: string;
  hostname?: string;
  fleetlensVersion?: string;
  stats: RuntimeStats;
  agentSources: RuntimeAgentSourceSummary[];
  /** Top N projects by recent activity, capped to keep payload small. */
  recentProjects: RuntimeProjectSummary[];
  /** Recent session metadata for cross-runtime lists. Capped at
   *  REMOTE_SESSIONS_CAP and sorted by lastTimestamp desc. Transcripts
   *  are NOT shipped — only metadata + activeSegments. */
  sessions: WireSessionMeta[];
  /** Only set on remote runtimes — null for the local self-runtime. */
  connection: {
    since: string;
    lastSeen: string;
  } | null;
  /** When this snapshot was captured on the source machine. */
  capturedAt: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/**
 * Compute a RuntimeInfo for this machine by scanning every registered
 * AgentSource and rolling up the SessionMeta lists. Intentionally cheap
 * enough to call every minute from the fleet worker.
 */
export async function computeLocalRuntimeInfo(opts: {
  deviceId: string;
  publicKey: string;
  label?: string;
  fleetlensVersion?: string;
  /** Max recentProjects entries to return. */
  topProjects?: number;
}): Promise<RuntimeInfo> {
  const topProjects = opts.topProjects ?? 8;
  const now = Date.now();
  const day24Ago = now - DAY_MS;
  const day7Ago = now - WEEK_MS;

  const perSource = await Promise.all(
    agentSources.map(async (source) => ({
      source,
      sessions: await safeListSessions(source),
    })),
  );

  const allSessions: SessionMeta[] = perSource.flatMap((p) => p.sessions);

  const stats = computeStats(allSessions, now, day24Ago, day7Ago);

  const agentSourceSummaries: RuntimeAgentSourceSummary[] = perSource.map(
    ({ source, sessions }) => ({
      kind: source.kind,
      totalSessions: sessions.length,
      sessionsLast24h: sessions.filter((s) => sessionEndMs(s) >= day24Ago).length,
    }),
  );

  const recentProjects = computeRecentProjects(allSessions, day7Ago, topProjects);
  const sessions = buildWireSessions(allSessions, REMOTE_SESSIONS_CAP);

  return {
    protocol: RUNTIME_INFO_PROTOCOL_VERSION,
    deviceId: opts.deviceId,
    publicKey: opts.publicKey,
    isLocal: true,
    label: opts.label,
    hostname: hostname(),
    fleetlensVersion: opts.fleetlensVersion,
    stats,
    agentSources: agentSourceSummaries,
    recentProjects,
    sessions,
    connection: null,
    capturedAt: new Date().toISOString(),
  };
}

function buildWireSessions(
  sessions: SessionMeta[],
  cap: number,
): WireSessionMeta[] {
  // Most-recent first; trims to cap before stripping the source-only
  // field so the cost stays proportional to cap.
  return sessions
    .slice()
    .sort((a, b) => sessionEndMs(b) - sessionEndMs(a))
    .slice(0, cap)
    .map((s) => {
      const { filePath: _filePath, ...rest } = s;
      void _filePath;
      return rest;
    });
}

async function safeListSessions(source: AgentSource): Promise<SessionMeta[]> {
  try {
    return await source.listSessions();
  } catch {
    // A broken agent dir (permissions, partial install) shouldn't blank
    // the whole runtime card. Skip and keep going.
    return [];
  }
}

function sessionEndMs(s: SessionMeta): number {
  if (s.lastTimestamp) return Date.parse(s.lastTimestamp);
  if (s.firstTimestamp) return Date.parse(s.firstTimestamp);
  return 0;
}

function computeStats(
  sessions: SessionMeta[],
  now: number,
  day24Ago: number,
  day7Ago: number,
): RuntimeStats {
  let sessionsLast24h = 0;
  let sessionsLast7d = 0;
  let agentTimeLast24hMs = 0;
  let agentTimeLast7dMs = 0;
  let lastActivityMs = 0;

  for (const s of sessions) {
    const end = sessionEndMs(s);
    if (end > lastActivityMs) lastActivityMs = end;
    if (end >= day24Ago) sessionsLast24h++;
    if (end >= day7Ago) sessionsLast7d++;

    const segs = s.activeSegments ?? [];
    for (const seg of segs) {
      const clip24 = clip(seg, day24Ago, now);
      if (clip24 > 0) agentTimeLast24hMs += clip24;
      const clip7 = clip(seg, day7Ago, now);
      if (clip7 > 0) agentTimeLast7dMs += clip7;
    }
  }

  return {
    totalSessions: sessions.length,
    sessionsLast24h,
    sessionsLast7d,
    agentTimeLast24hMs,
    agentTimeLast7dMs,
    lastActivityAt:
      lastActivityMs > 0 ? new Date(lastActivityMs).toISOString() : undefined,
  };
}

function clip(
  seg: { startMs: number; endMs: number },
  startMs: number,
  endMs: number,
): number {
  const a = Math.max(seg.startMs, startMs);
  const b = Math.min(seg.endMs, endMs);
  return Math.max(0, b - a);
}

function computeRecentProjects(
  sessions: SessionMeta[],
  sinceMs: number,
  topN: number,
): RuntimeProjectSummary[] {
  const map = new Map<
    string,
    { name: string; sessionCount: number; lastActivityMs: number; agentTimeMs: number }
  >();

  for (const s of sessions) {
    const end = sessionEndMs(s);
    if (end < sinceMs) continue;
    const name = canonicalProjectName(s.projectName || s.projectDir);
    const entry = map.get(name) ?? {
      name,
      sessionCount: 0,
      lastActivityMs: 0,
      agentTimeMs: 0,
    };
    entry.sessionCount++;
    if (end > entry.lastActivityMs) entry.lastActivityMs = end;
    for (const seg of s.activeSegments ?? []) {
      entry.agentTimeMs += Math.max(0, seg.endMs - seg.startMs);
    }
    map.set(name, entry);
  }

  return [...map.values()]
    .sort((a, b) => b.lastActivityMs - a.lastActivityMs)
    .slice(0, topN)
    .map((e) => ({
      name: e.name,
      sessionCount: e.sessionCount,
      lastActivityAt: new Date(e.lastActivityMs).toISOString(),
      agentTimeMs: e.agentTimeMs,
    }));
}

// Re-export DailyBucket so any consumer that wants per-day rollups can
// follow up by calling dailyActivity() themselves without importing the
// parser directly. Kept here so the wire protocol can grow into "include
// last-7-days bars on the runtime card" without breaking imports.
export type { DailyBucket };

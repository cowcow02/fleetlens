/**
 * Server-only data access layer.
 *
 * Wraps @claude-lens/parser/fs with a per-request cache so a single RSC
 * render doesn't re-scan the agent disk roots for every page that needs
 * the session list. Multi-agent: iterates the parser's AgentSource
 * registry, so adding a new agent means adding one source — no edits here.
 *
 * Cross-runtime: when a fleet is configured and the worker has populated
 * ~/.cclens/fleet/runtimes.json, this layer also unions every connected
 * peer's session metadata into listSessions(). Each session is stamped
 * with `runtimeId / runtimeLabel / runtimeHostname` so the existing
 * UI can attribute rows back to the source machine and so analytics
 * helpers (dailyActivity, groupByProject, …) keep working unchanged.
 */

import "server-only";
import { cache } from "react";
import { listAllSessions, getAnySession } from "@claude-lens/parser/fs";
import type { SessionMeta } from "@claude-lens/parser";
import { readFleetState, type WireSessionRecord, type RuntimeInfo } from "./fleet-data";

export const LOCAL_RUNTIME_ID = "local";

export const listSessions = cache(async (): Promise<SessionMeta[]> => {
  const local = (await listAllSessions({ limit: 1000 })).map<SessionMeta>((s) => ({
    ...s,
    runtimeId: s.runtimeId ?? LOCAL_RUNTIME_ID,
    runtimeLabel: s.runtimeLabel ?? "this machine",
  }));

  const remote = collectRemoteSessions();
  if (remote.length === 0) return local;

  return [...local, ...remote];
});

export const getSession = cache(async (id: string) => {
  return getAnySession(id);
});

/**
 * Pull remote sessions out of the runtimes snapshot and re-stamp them
 * with their owning runtime's deviceId/label so downstream code can tell
 * them apart from local sessions without re-reading the file.
 */
function collectRemoteSessions(): SessionMeta[] {
  const state = readFleetState();
  if (!state.configured || !state.snapshot) return [];
  const out: SessionMeta[] = [];
  for (const rt of state.snapshot.runtimes as RuntimeInfo[]) {
    if (rt.isLocal) continue;
    if (!Array.isArray(rt.sessions) || rt.sessions.length === 0) continue;
    for (const rec of rt.sessions) {
      out.push(remoteSessionToSessionMeta(rec, rt));
    }
  }
  return out;
}

function remoteSessionToSessionMeta(
  rec: WireSessionRecord,
  rt: RuntimeInfo,
): SessionMeta {
  // The wire payload is structurally a SessionMeta minus filePath and the
  // preview fields. We re-add a synthetic filePath that's clearly remote
  // (callers like getAnySession will return null for it, which is the
  // desired behavior — no JSONL transcripts cross the wire in this
  // iteration).
  const filePath = `<remote://${rt.deviceId}/${rec.id}>`;
  return {
    ...(rec as unknown as SessionMeta),
    filePath,
    runtimeId: rt.deviceId,
    runtimeLabel: rt.label ?? rt.deviceId,
    runtimeHostname: rt.hostname,
  } satisfies SessionMeta;
}

/**
 * Filter helper for pages that want to scope by runtime via ?runtime=...
 * URL searchparam. Used by /sessions and friends.
 *
 *  - undefined / "all"            → return everything
 *  - "local" or "this-machine"    → only this machine
 *  - any other string             → match against runtimeId (exact)
 */
export function filterByRuntime<T extends { runtimeId?: string }>(
  rows: T[],
  runtimeId: string | undefined,
): T[] {
  if (!runtimeId || runtimeId === "all") return rows;
  if (runtimeId === "local" || runtimeId === "this-machine") {
    return rows.filter((r) => !r.runtimeId || r.runtimeId === LOCAL_RUNTIME_ID);
  }
  return rows.filter((r) => r.runtimeId === runtimeId);
}

/** All known runtimes for filter UIs. Always includes a synthetic "local"
 *  entry even when no fleet is configured. */
export type RuntimeFilterOption = {
  id: string;
  label: string;
  hostname?: string;
  isLocal: boolean;
  /** Connected = currently online; null = no fleet / local. */
  connected: boolean | null;
};

export function listRuntimeFilterOptions(): RuntimeFilterOption[] {
  const state = readFleetState();
  const local: RuntimeFilterOption = {
    id: LOCAL_RUNTIME_ID,
    label: "this machine",
    isLocal: true,
    connected: null,
  };
  if (!state.configured || !state.snapshot) return [local];
  const out: RuntimeFilterOption[] = [local];
  for (const rt of state.snapshot.runtimes as RuntimeInfo[]) {
    if (rt.isLocal) continue;
    out.push({
      id: rt.deviceId,
      label: rt.label ?? rt.deviceId,
      hostname: rt.hostname,
      isLocal: false,
      connected: !!rt.connection,
    });
  }
  return out;
}

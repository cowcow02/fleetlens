/**
 * On-disk layout for the fleet feature, all under ~/.cclens/fleet/:
 *
 *   fleet.json        Shared trust root: { secret, createdAt, label?, role }.
 *                     Mode 0600 — this is the join secret for the whole fleet.
 *   identity.json     Per-machine: { publicKey, seed }. Worker generates on
 *                     first boot. Mode 0600 (seed is the keypair).
 *   peers.json        TOFU directory: { peers: { [pubkey]: PeerRecord } }.
 *                     Worker updates on connect / disconnect.
 *   connections.json  Live snapshot of currently-connected peers, written
 *                     by the worker on every connect / disconnect.
 *   fleet.log         Stderr from the worker.
 *
 * fleet.pid + the worker process itself live at ~/.cclens/fleet.pid /
 * ~/.cclens/fleet.log respectively, mirroring the existing daemon layout.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { cclensPath } from "@claude-lens/parser/fs";

export const FLEET_DIR = cclensPath("fleet");
export const FLEET_FILE = cclensPath("fleet", "fleet.json");
export const IDENTITY_FILE = cclensPath("fleet", "identity.json");
export const PEERS_FILE = cclensPath("fleet", "peers.json");
export const CONNECTIONS_FILE = cclensPath("fleet", "connections.json");
export const FLEET_PID = cclensPath("fleet.pid");
export const FLEET_LOG = cclensPath("fleet.log");

export type FleetRecord = {
  /** 16-byte hex shared secret. */
  secret: string;
  /** ISO timestamp when this fleet was created or joined on this machine. */
  createdAt: string;
  /** Optional human label for the fleet — purely cosmetic. */
  label?: string;
  /** "init" if this machine generated the secret, "join" if it accepted one. */
  role: "init" | "join";
};

export type IdentityRecord = {
  /** 32-byte hex curve25519 public key, used as the device identity. */
  publicKey: string;
  /** 32-byte hex seed used to deterministically re-derive the keypair. */
  seed: string;
  /** ISO timestamp when this identity was generated. */
  createdAt: string;
  /** Cached hostname at time of generation, surfaced in `fleet status`. */
  hostname: string;
};

export type PeerRecord = {
  publicKey: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Last known label/hostname the peer advertised. */
  label?: string;
  hostname?: string;
};

export type PeersFile = {
  peers: Record<string, PeerRecord>;
};

export type ConnectionRecord = {
  publicKey: string;
  deviceId: string;
  label?: string;
  hostname?: string;
  /** ISO timestamp when this connection was established. */
  since: string;
  /** ISO timestamp of last successful round-trip (ping or hello). */
  lastSeen: string;
};

export type ConnectionsFile = {
  updatedAt: string;
  connections: ConnectionRecord[];
};

function ensureDir(): void {
  mkdirSync(FLEET_DIR, { recursive: true });
}

export function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Atomic JSON write: stage to a sibling .tmp then rename. Files holding
 * secrets (fleet.json, identity.json) are written 0600.
 */
export function writeJsonAtomic(
  filePath: string,
  data: unknown,
  opts: { mode?: number } = {},
): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), {
    mode: opts.mode ?? 0o644,
    encoding: "utf8",
  });
  renameSync(tmp, filePath);
}

export function readFleet(): FleetRecord | null {
  return readJson<FleetRecord>(FLEET_FILE);
}

export function writeFleet(fleet: FleetRecord): void {
  ensureDir();
  writeJsonAtomic(FLEET_FILE, fleet, { mode: 0o600 });
}

export function clearFleet(): void {
  for (const p of [FLEET_FILE, IDENTITY_FILE, PEERS_FILE, CONNECTIONS_FILE]) {
    try {
      if (existsSync(p)) renameSync(p, `${p}.removed.${Date.now()}`);
    } catch {
      // Best effort — if the rename fails the next init/join will overwrite.
    }
  }
}

export function readIdentity(): IdentityRecord | null {
  return readJson<IdentityRecord>(IDENTITY_FILE);
}

export function writeIdentity(identity: IdentityRecord): void {
  ensureDir();
  writeJsonAtomic(IDENTITY_FILE, identity, { mode: 0o600 });
}

export function readPeers(): PeersFile {
  return readJson<PeersFile>(PEERS_FILE) ?? { peers: {} };
}

export function writePeers(file: PeersFile): void {
  ensureDir();
  writeJsonAtomic(PEERS_FILE, file);
}

export function readConnections(): ConnectionsFile | null {
  const f = readJson<ConnectionsFile>(CONNECTIONS_FILE);
  if (!f) return null;
  // Stale-detect: a worker that crashed without cleanup leaves a connections
  // file behind. If the file is older than 60s, callers should treat it as
  // empty — the worker writes at least every 30s while alive. The stat may
  // race with a concurrent clearFleet() that just unlinked the file; treat
  // ENOENT the same as "no longer fresh".
  let mtimeMs: number;
  try {
    mtimeMs = statSync(CONNECTIONS_FILE).mtimeMs;
  } catch {
    return { updatedAt: f.updatedAt, connections: [] };
  }
  if (Date.now() - mtimeMs > 60_000) return { updatedAt: f.updatedAt, connections: [] };
  return f;
}

export function writeConnections(file: ConnectionsFile): void {
  ensureDir();
  writeJsonAtomic(CONNECTIONS_FILE, file);
}

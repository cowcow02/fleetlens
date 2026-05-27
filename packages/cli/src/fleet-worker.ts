/**
 * Fleet swarm worker. Runs detached as `dist/fleet-worker.js`.
 *
 * Reads ~/.cclens/fleet/fleet.json for the shared secret, generates (or
 * loads) the per-machine identity keypair, joins a Hyperswarm topic
 * derived from the secret, and exposes a tiny RPC to every peer that
 * authenticates via the same shared topic.
 *
 * Trust model: the topic itself is `SHA-256("fleetlens-fleet:v1:" || secret)`.
 * Only peers holding the same secret can find each other in the DHT, and
 * every connection is a Hyperswarm-Noise-authenticated stream. There is no
 * additional handshake — possession of the fleet secret IS the trust token,
 * exactly like Syncthing's introducer-secret model.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { createRequire } from "node:module";

import {
  CONNECTIONS_FILE,
  FLEET_LOG,
  readFleet,
  readIdentity,
  readPeers,
  writeConnections,
  writeIdentity,
  writePeers,
  writeRuntimesSnapshot,
  type ConnectionRecord,
  type PeerRecord,
} from "./fleet/storage.js";
import { attachRpc, type RpcSession } from "./fleet/rpc.js";
import { deriveTopic } from "./fleet/topic.js";
import { shortDeviceId } from "./fleet/code.js";
import {
  computeLocalRuntimeInfo,
  RUNTIME_INFO_PROTOCOL_VERSION,
  type RuntimeInfo,
} from "./fleet/runtime.js";

declare const CLI_VERSION: string;

// Hyperswarm + hyperdht are CommonJS native-backed packages. createRequire
// lets us load them from the bundled ESM worker without going through
// esbuild — they are marked external in build.mjs.
const require = createRequire(import.meta.url);
const Hyperswarm = require("hyperswarm") as new (
  opts?: Record<string, unknown>,
) => HyperswarmInstance;
const HyperDHT = require("hyperdht") as {
  keyPair: (seed: Buffer) => { publicKey: Buffer; secretKey: Buffer };
};

type HyperswarmConnection = import("node:stream").Duplex & {
  remotePublicKey: Buffer;
};

type HyperswarmInstance = {
  keyPair: { publicKey: Buffer; secretKey: Buffer };
  join: (topic: Buffer, opts?: Record<string, unknown>) => { flushed: () => Promise<void> };
  on: (event: string, fn: (...args: unknown[]) => void) => void;
  flush: () => Promise<void>;
  destroy: () => Promise<void>;
};

const CONNECTIONS_FLUSH_MS = 30_000;
const PING_INTERVAL_MS = 30_000;
// Pulls a fresh RuntimeInfo from every connected peer at this cadence.
// 60s keeps the /runtimes page reasonably live without hammering peers
// with full session scans every few seconds. Tweak via env if needed.
const RUNTIMES_REFRESH_MS = Number(process.env.FLEETLENS_RUNTIMES_REFRESH_MS ?? 60_000);
// First refresh happens shortly after the worker boots so the dashboard
// has data faster than RUNTIMES_REFRESH_MS would imply.
const RUNTIMES_FIRST_REFRESH_MS = 3_000;

mkdirSync(dirname(FLEET_LOG), { recursive: true });

type LogLevel = "info" | "warn" | "error";
function log(level: LogLevel, msg: string): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${msg}\n`;
  try {
    appendFileSync(FLEET_LOG, line, "utf8");
  } catch {
    // Disk might be full; keep going.
  }
}

const fleet = readFleet();
if (!fleet) {
  log("error", "no fleet configured — exiting (run `fleetlens fleet init` or join first)");
  process.exit(1);
}

// Identity: stable across restarts. Generated on first run from a random
// 32-byte seed; HyperDHT.keyPair(seed) is deterministic so we only need
// the seed on disk. The cached publicKey makes `fleet status` cheap (no
// crypto needed in the CLI command).
let identity = readIdentity();
if (!identity) {
  const seed = randomBytes(32);
  const kp = HyperDHT.keyPair(seed);
  identity = {
    publicKey: kp.publicKey.toString("hex"),
    seed: seed.toString("hex"),
    createdAt: new Date().toISOString(),
    hostname: hostname(),
  };
  writeIdentity(identity);
  log("info", `generated identity ${shortDeviceId(identity.publicKey)}`);
} else {
  log("info", `loaded identity ${shortDeviceId(identity.publicKey)}`);
}

const seedBuf = Buffer.from(identity.seed, "hex");
const swarm = new Hyperswarm({ seed: seedBuf });

const myDeviceId = shortDeviceId(identity.publicKey);
const myHostname = identity.hostname;
const myLabel = fleet.label;

type LiveConnection = {
  publicKey: string;
  deviceId: string;
  label?: string;
  hostname?: string;
  since: string;
  lastSeen: string;
  // Filled in immediately after attachRpc returns. Optional so the entry
  // can be registered in `live` *before* attachRpc runs, eliminating the
  // race where a peer sends "hello" before our handler can find itself.
  rpc?: RpcSession;
};

const live = new Map<string, LiveConnection>();

function flushConnections(): void {
  const connections: ConnectionRecord[] = [...live.values()].map((c) => ({
    publicKey: c.publicKey,
    deviceId: c.deviceId,
    label: c.label,
    hostname: c.hostname,
    since: c.since,
    lastSeen: c.lastSeen,
  }));
  writeConnections({ updatedAt: new Date().toISOString(), connections });
}

function rememberPeer(publicKey: string, label?: string, host?: string): void {
  const peers = readPeers();
  const now = new Date().toISOString();
  const existing = peers.peers[publicKey];
  const rec: PeerRecord = existing
    ? { ...existing, lastSeenAt: now, label: label ?? existing.label, hostname: host ?? existing.hostname }
    : { publicKey, firstSeenAt: now, lastSeenAt: now, label, hostname: host };
  peers.peers[publicKey] = rec;
  writePeers(peers);
}

type HelloPayload = {
  deviceId: string;
  publicKey: string;
  hostname?: string;
  label?: string;
  agent: "fleetlens";
  protocol: 1;
};

function makeHello(): HelloPayload {
  return {
    deviceId: myDeviceId,
    publicKey: identity!.publicKey,
    hostname: myHostname,
    label: myLabel,
    agent: "fleetlens",
    protocol: 1,
  };
}

swarm.on("connection", (conn: unknown, info: unknown) => {
  // `conn` is a NoiseSecretStream (Duplex) with .remotePublicKey set.
  void onConnection(conn as HyperswarmConnection, info);
});

async function onConnection(conn: HyperswarmConnection, _info: unknown): Promise<void> {
  const remotePubHex = conn.remotePublicKey.toString("hex");
  const remoteDeviceId = shortDeviceId(remotePubHex);
  // Hyperswarm can dial a peer from both sides simultaneously. If we're
  // already connected to this pubkey, drop the new connection cleanly.
  // attachRpc isn't called for the duplicate, so attach a no-op error
  // listener ourselves — without one, an 'error' emitted before 'close'
  // becomes an unhandled exception.
  if (live.has(remotePubHex)) {
    log("info", `duplicate connection to ${remoteDeviceId}, dropping new one`);
    conn.on("error", () => {});
    try {
      conn.destroy();
    } catch {
      /* noop */
    }
    return;
  }

  // Register the entry *before* wiring RPC so the "hello" handler can
  // always find itself in `live` — even if the peer races us and sends
  // hello before our attachRpc call returns. rpc is filled in below.
  const nowIso = new Date().toISOString();
  const entry: LiveConnection = {
    publicKey: remotePubHex,
    deviceId: remoteDeviceId,
    since: nowIso,
    lastSeen: nowIso,
  };
  live.set(remotePubHex, entry);

  const rpc = attachRpc(conn, async (method, params) => {
    switch (method) {
      case "ping":
        return { pong: true, ts: new Date().toISOString() };
      case "hello":
        // Update local label/host info opportunistically.
        if (params && typeof params === "object") {
          const p = params as Partial<HelloPayload>;
          const existing = live.get(remotePubHex);
          if (existing) {
            existing.label = p.label ?? existing.label;
            existing.hostname = p.hostname ?? existing.hostname;
            existing.lastSeen = new Date().toISOString();
            flushConnections();
            rememberPeer(remotePubHex, existing.label, existing.hostname);
          }
        }
        return makeHello();
      case "getInfo": {
        // Compute on demand. Peers call this every RUNTIMES_REFRESH_MS,
        // so this runs maybe once a minute per peer — cheap.
        const info = await computeLocalRuntimeInfo({
          deviceId: myDeviceId,
          publicKey: identity!.publicKey,
          label: myLabel,
          fleetlensVersion: CLI_VERSION,
        });
        return info;
      }
      default:
        throw new Error(`unknown method: ${method}`);
    }
  });
  entry.rpc = rpc;

  flushConnections();
  log("info", `connected to ${remoteDeviceId} (${remotePubHex.slice(0, 8)}…)`);

  // Exchange hello to learn the peer's label/hostname.
  try {
    const reply = (await rpc.call("hello", makeHello(), 5_000)) as HelloPayload;
    entry.label = reply?.label ?? entry.label;
    entry.hostname = reply?.hostname ?? entry.hostname;
    entry.lastSeen = new Date().toISOString();
    flushConnections();
    rememberPeer(remotePubHex, entry.label, entry.hostname);
  } catch (err) {
    log("warn", `hello to ${remoteDeviceId} failed: ${(err as Error).message}`);
  }

  // Periodic keepalive ping. Keeps connections.json fresh and detects
  // half-open connections that the OS doesn't notice.
  const pingTimer = setInterval(() => {
    rpc
      .call("ping", undefined, 5_000)
      .then(() => {
        entry.lastSeen = new Date().toISOString();
        flushConnections();
      })
      .catch(() => {
        try {
          conn.destroy();
        } catch {
          /* noop */
        }
      });
  }, PING_INTERVAL_MS);

  conn.on("close", () => {
    clearInterval(pingTimer);
    live.delete(remotePubHex);
    flushConnections();
    rememberPeer(remotePubHex, entry.label, entry.hostname);
    log("info", `disconnected from ${remoteDeviceId}`);
  });
  conn.on("error", (err: Error) => {
    log("warn", `connection error with ${remoteDeviceId}: ${err.message}`);
  });
}

const topic = deriveTopic(fleet.secret);
const discovery = swarm.join(topic, { server: true, client: true });
log("info", `joining swarm topic ${topic.toString("hex").slice(0, 16)}…`);

// `discovery.flushed()` resolves after the first server announce / client
// lookup round on the DHT. Useful to log "we're now findable" but not
// required to accept connections — those start arriving as soon as the
// announce reaches the DHT.
discovery
  .flushed()
  .then(() => log("info", "swarm join flushed (announce + lookup complete)"))
  .catch((err: Error) => log("warn", `swarm flush failed: ${err.message}`));

// Heartbeat: refresh connections.json mtime even when no peers are connected,
// so CLI status can distinguish "no peers" from "worker dead".
setInterval(() => flushConnections(), CONNECTIONS_FLUSH_MS);
flushConnections();

// Runtimes snapshot: compute our own RuntimeInfo + fan out getInfo to every
// connected peer, then write the union to ~/.cclens/fleet/runtimes.json.
// The /runtimes page reads this file. Pull cadence is intentionally slower
// than the connection heartbeat — peers don't need sub-second freshness.
let runtimesRefreshInFlight = false;
async function refreshRuntimes(): Promise<void> {
  if (runtimesRefreshInFlight) return;
  runtimesRefreshInFlight = true;
  const startMs = Date.now();
  try {
    const local = await computeLocalRuntimeInfo({
      deviceId: myDeviceId,
      publicKey: identity!.publicKey,
      label: myLabel,
      fleetlensVersion: CLI_VERSION,
    });
    const remoteResults = await Promise.all(
      [...live.values()].map(async (c) => {
        const fallback = stubRuntimeFromConnection(c);
        if (!c.rpc) return fallback;
        try {
          const info = (await c.rpc.call("getInfo", undefined, 8_000)) as RuntimeInfo;
          // Stamp connection metadata (since/lastSeen) onto whatever the
          // peer reported; treat the peer-reported isLocal as advisory and
          // override here — from this machine's perspective, they're remote.
          return {
            ...info,
            isLocal: false,
            connection: { since: c.since, lastSeen: c.lastSeen },
          } as RuntimeInfo;
        } catch (err) {
          // Peer is connected but on an older build without getInfo (or
          // it errored). Still surface them on /runtimes using the hello
          // data we already have, so the UI matches reality.
          log(
            "warn",
            `getInfo to ${c.deviceId} failed (${(err as Error).message}); showing hello-only stub`,
          );
          return fallback;
        }
      }),
    );
    const runtimes: RuntimeInfo[] = [
      local,
      ...remoteResults.filter((r): r is RuntimeInfo => r !== null),
    ];
    writeRuntimesSnapshot({
      updatedAt: new Date().toISOString(),
      runtimes,
    });
    log(
      "info",
      `runtimes refreshed: ${runtimes.length} runtime${runtimes.length === 1 ? "" : "s"} (${Date.now() - startMs}ms)`,
    );
  } catch (err) {
    log("error", `refreshRuntimes failed: ${(err as Error).message}`);
  } finally {
    runtimesRefreshInFlight = false;
  }
}
/**
 * Hello-only stub used when a peer is connected but cannot answer getInfo
 * (typically: connected to an older fleetlens build, or transient RPC
 * error). The peer is real, we just have no stats yet — surface what we
 * learned from the hello handshake.
 */
function stubRuntimeFromConnection(c: LiveConnection): RuntimeInfo {
  return {
    protocol: RUNTIME_INFO_PROTOCOL_VERSION,
    deviceId: c.deviceId,
    publicKey: c.publicKey,
    isLocal: false,
    label: c.label,
    hostname: c.hostname,
    fleetlensVersion: undefined,
    stats: {
      totalSessions: 0,
      sessionsLast24h: 0,
      sessionsLast7d: 0,
      agentTimeLast24hMs: 0,
      agentTimeLast7dMs: 0,
    },
    agentSources: [],
    recentProjects: [],
    sessions: [],
    connection: { since: c.since, lastSeen: c.lastSeen },
    capturedAt: new Date().toISOString(),
  };
}
setTimeout(() => void refreshRuntimes(), RUNTIMES_FIRST_REFRESH_MS);
setInterval(() => void refreshRuntimes(), RUNTIMES_REFRESH_MS);

log(
  "info",
  `fleet worker started (pid=${process.pid}, device=${myDeviceId}, hostname=${myHostname})`,
);

async function shutdown(signal: string): Promise<void> {
  log("info", `received ${signal}; shutting down`);
  try {
    for (const c of live.values()) c.rpc?.close();
    live.clear();
    flushConnections();
    await swarm.destroy();
  } catch (err) {
    log("warn", `shutdown error: ${(err as Error).message}`);
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

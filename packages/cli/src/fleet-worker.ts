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
  type ConnectionRecord,
  type PeerRecord,
} from "./fleet/storage.js";
import { attachRpc, type RpcSession } from "./fleet/rpc.js";
import { deriveTopic } from "./fleet/topic.js";
import { shortDeviceId } from "./fleet/code.js";

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
  rpc: RpcSession;
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
  if (live.has(remotePubHex)) {
    log("info", `duplicate connection to ${remoteDeviceId}, dropping new one`);
    try {
      conn.destroy();
    } catch {
      /* noop */
    }
    return;
  }

  const rpc = attachRpc(conn, async (method, params) => {
    switch (method) {
      case "ping":
        return { pong: true, ts: new Date().toISOString() };
      case "hello":
        // Update local label/host info opportunistically.
        if (params && typeof params === "object") {
          const p = params as Partial<HelloPayload>;
          const entry = live.get(remotePubHex);
          if (entry) {
            entry.label = p.label ?? entry.label;
            entry.hostname = p.hostname ?? entry.hostname;
            entry.lastSeen = new Date().toISOString();
            flushConnections();
            rememberPeer(remotePubHex, entry.label, entry.hostname);
          }
        }
        return makeHello();
      default:
        throw new Error(`unknown method: ${method}`);
    }
  });

  const nowIso = new Date().toISOString();
  const entry: LiveConnection = {
    publicKey: remotePubHex,
    deviceId: remoteDeviceId,
    since: nowIso,
    lastSeen: nowIso,
    rpc,
  };
  live.set(remotePubHex, entry);
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

log(
  "info",
  `fleet worker started (pid=${process.pid}, device=${myDeviceId}, hostname=${myHostname})`,
);

async function shutdown(signal: string): Promise<void> {
  log("info", `received ${signal}; shutting down`);
  try {
    for (const c of live.values()) c.rpc.close();
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

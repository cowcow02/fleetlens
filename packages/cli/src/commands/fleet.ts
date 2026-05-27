import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";

import {
  cleanStalePid,
  isProcessAlive,
  readPid,
  removePid,
  writePid,
} from "../pid.js";
import {
  CONNECTIONS_FILE,
  FLEET_LOG,
  FLEET_PID,
  clearFleet,
  readConnections,
  readFleet,
  readIdentity,
  readPeers,
  writeFleet,
} from "../fleet/storage.js";
import {
  decodeFleetCode,
  encodeFleetCode,
  generateFleetSecret,
  shortDeviceId,
} from "../fleet/code.js";

function workerPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "fleet-worker.js");
}

type StartResult =
  | { started: true; pid: number; alreadyRunning: false }
  | { started: false; pid: number; alreadyRunning: true }
  | { started: false; pid: null; alreadyRunning: false; error: string };

export function startFleetWorkerSilent(): StartResult {
  cleanStalePid(FLEET_PID);
  const existing = readPid(FLEET_PID);
  if (existing !== null && isProcessAlive(existing.pid)) {
    return { started: false, pid: existing.pid, alreadyRunning: true };
  }
  const script = workerPath();
  if (!existsSync(script)) {
    return {
      started: false,
      pid: null,
      alreadyRunning: false,
      error: `Fleet worker not found at ${script}. Rebuild with: pnpm -F fleetlens build`,
    };
  }
  if (!readFleet()) {
    return {
      started: false,
      pid: null,
      alreadyRunning: false,
      error: "No fleet configured. Run `fleetlens fleet init` (first machine) or `fleetlens fleet join <code>` (other machines).",
    };
  }
  const child = spawn(process.execPath, [script], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  const pid = child.pid!;
  writePid(FLEET_PID, pid);
  return { started: true, pid, alreadyRunning: false };
}

export function stopFleetWorkerSilent(): { stopped: boolean; pid: number | null } {
  cleanStalePid(FLEET_PID);
  const entry = readPid(FLEET_PID);
  if (entry === null) return { stopped: false, pid: null };
  try {
    process.kill(entry.pid, "SIGTERM");
  } catch {
    // already gone
  }
  removePid(FLEET_PID);
  return { stopped: true, pid: entry.pid };
}

export async function fleet(args: string[]): Promise<void> {
  const sub = args[0] ?? "status";
  switch (sub) {
    case "init":
      await fleetInit(args.slice(1));
      break;
    case "join":
      await fleetJoin(args.slice(1));
      break;
    case "code":
      fleetCode();
      break;
    case "status":
      fleetStatus();
      break;
    case "start":
      fleetStart();
      break;
    case "stop":
      fleetStop();
      break;
    case "leave":
      fleetLeave();
      break;
    case "logs":
      fleetLogs();
      break;
    case "peers":
      fleetPeers();
      break;
    default:
      console.error(`Unknown fleet subcommand: ${sub}`);
      printFleetHelp();
      process.exit(1);
  }
}

function printFleetHelp(): void {
  console.log(`Usage: fleetlens fleet <subcommand>

  init [--label NAME]      Create a new fleet on this machine and print the join code.
  join <code> [--label N]  Join an existing fleet using a code from \`fleet code\`.
  code                     Print this fleet's join code (run on machine that has the code).
  status                   Show fleet identity, worker state, and currently-connected peers.
  start                    Start the fleet worker (joins the swarm).
  stop                     Stop the fleet worker.
  leave                    Tear down the fleet on this machine (removes fleet.json + identity.json).
  logs                     Tail recent fleet worker logs.
  peers                    Show all peers this machine has ever seen.

Pairing flow:
  Machine A:  fleetlens fleet init --label "home laptop"
              → prints  flv1-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
  Machine B:  fleetlens fleet join flv1-XXXX-...   --label "work laptop"
              Both then:  fleetlens fleet status
`);
}

async function fleetInit(args: string[]): Promise<void> {
  const label = takeFlag(args, "--label");
  const existing = readFleet();
  if (existing) {
    console.error(
      "A fleet is already configured on this machine. Run `fleetlens fleet code` to see the join code, or `fleetlens fleet leave` to start over.",
    );
    process.exit(1);
  }
  const secret = generateFleetSecret();
  const code = encodeFleetCode(secret);
  writeFleet({
    secret: secret.toString("hex"),
    createdAt: new Date().toISOString(),
    label,
    role: "init",
  });
  console.log("Fleet created.\n");
  console.log(`  Join code:  ${code}`);
  if (label) console.log(`  Label:      ${label}`);
  console.log("\nShare the code above with your other machines, then run:");
  console.log(`  fleetlens fleet join ${code}\n`);

  await startWorkerAndWaitForIdentity();
}

async function fleetJoin(args: string[]): Promise<void> {
  const code = args[0];
  if (!code || code.startsWith("--")) {
    console.error("Usage: fleetlens fleet join <code> [--label NAME]");
    process.exit(1);
  }
  const label = takeFlag(args.slice(1), "--label");
  const existing = readFleet();
  if (existing) {
    console.error(
      "A fleet is already configured on this machine. Run `fleetlens fleet leave` first if you want to switch.",
    );
    process.exit(1);
  }
  let secret: Buffer;
  try {
    secret = decodeFleetCode(code);
  } catch (err) {
    console.error(`Invalid fleet code: ${(err as Error).message}`);
    process.exit(1);
  }
  writeFleet({
    secret: secret.toString("hex"),
    createdAt: new Date().toISOString(),
    label,
    role: "join",
  });
  console.log("Joined fleet.\n");
  await startWorkerAndWaitForIdentity();
}

function fleetCode(): void {
  const f = readFleet();
  if (!f) {
    console.error("No fleet configured. Run `fleetlens fleet init` first.");
    process.exit(1);
  }
  const code = encodeFleetCode(Buffer.from(f.secret, "hex"));
  console.log(code);
}

function fleetStatus(): void {
  const f = readFleet();
  if (!f) {
    console.log("Fleet: not configured");
    console.log("Run `fleetlens fleet init` to create one, or `fleetlens fleet join <code>` to join an existing fleet.");
    return;
  }
  const id = readIdentity();
  cleanStalePid(FLEET_PID);
  const pidEntry = readPid(FLEET_PID);
  const running = pidEntry !== null && isProcessAlive(pidEntry.pid);
  const conn = readConnections();

  console.log(`Fleet:     configured (role: ${f.role}${f.label ? `, label: ${f.label}` : ""})`);
  console.log(`Worker:    ${running ? `running (PID ${pidEntry!.pid})` : "not running"}`);
  if (id) {
    console.log(`Device:    ${shortDeviceId(id.publicKey)}  (host: ${id.hostname})`);
    console.log(`Pubkey:    ${id.publicKey.slice(0, 16)}…`);
  } else {
    console.log("Device:    not generated yet (start the worker)");
  }

  if (running) {
    const peers = conn?.connections ?? [];
    if (peers.length === 0) {
      console.log("Peers:     none connected (searching…)");
    } else {
      console.log(`Peers:     ${peers.length} connected`);
      for (const p of peers) {
        const ageMs = Date.now() - new Date(p.since).getTime();
        const ageStr = formatAge(ageMs);
        const tag = p.label ? ` "${p.label}"` : "";
        const host = p.hostname ? ` (${p.hostname})` : "";
        console.log(`  - ${p.deviceId}${tag}${host} — up ${ageStr}`);
      }
    }
  }
}

function fleetStart(): void {
  const result = startFleetWorkerSilent();
  if (result.alreadyRunning) {
    console.log(`Fleet worker already running (PID ${result.pid})`);
    return;
  }
  if (!result.started) {
    console.error(result.error);
    process.exit(1);
  }
  console.log(`Fleet worker started (PID ${result.pid})`);
  console.log(`Logs: ${FLEET_LOG}`);
}

function fleetStop(): void {
  const result = stopFleetWorkerSilent();
  if (!result.stopped) {
    console.log("Fleet worker is not running.");
    return;
  }
  console.log(`Stopped fleet worker (PID ${result.pid})`);
}

function fleetLeave(): void {
  const result = stopFleetWorkerSilent();
  if (result.stopped) console.log(`Stopped fleet worker (PID ${result.pid})`);
  if (!readFleet()) {
    console.log("No fleet configured on this machine.");
    return;
  }
  clearFleet();
  console.log("Fleet configuration removed. Existing files are renamed with a .removed timestamp suffix in ~/.cclens/fleet/.");
}

function fleetLogs(): void {
  if (!existsSync(FLEET_LOG)) {
    console.log("No fleet logs yet.");
    return;
  }
  const content = readFileSync(FLEET_LOG, "utf8");
  const lines = content.trim().split("\n").slice(-30);
  for (const line of lines) process.stdout.write(line + "\n");
}

function fleetPeers(): void {
  const peers = readPeers().peers;
  const ids = Object.keys(peers);
  if (ids.length === 0) {
    console.log("No peers seen yet.");
    return;
  }
  console.log(`${ids.length} peer${ids.length === 1 ? "" : "s"} seen on ${hostname()}:`);
  for (const pk of ids) {
    const p = peers[pk];
    const id = shortDeviceId(p.publicKey);
    const tag = p.label ? ` "${p.label}"` : "";
    const host = p.hostname ? ` (${p.hostname})` : "";
    console.log(`  - ${id}${tag}${host}`);
    console.log(`      first seen ${p.firstSeenAt}`);
    console.log(`      last  seen ${p.lastSeenAt}`);
  }
}

async function startWorkerAndWaitForIdentity(): Promise<void> {
  const result = startFleetWorkerSilent();
  if (result.alreadyRunning) {
    console.log(`Fleet worker already running (PID ${result.pid}).`);
    return;
  }
  if (!result.started) {
    console.error(result.error);
    process.exit(1);
  }
  console.log(`Started fleet worker (PID ${result.pid}). Logs: ${FLEET_LOG}`);
  // Wait briefly for the worker to generate identity.json so the next
  // `fleet status` has something useful to show. 5s is generous — keypair
  // derivation is microseconds; we're mostly tolerating cold-start I/O.
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const id = readIdentity();
    if (id) {
      console.log(`This machine: ${shortDeviceId(id.publicKey)}  (host: ${id.hostname})`);
      console.log(`\nRun \`fleetlens fleet status\` to see connected peers.`);
      return;
    }
    await sleep(100);
  }
  console.log(
    "(Worker is starting — run `fleetlens fleet status` in a moment to see your device id and connected peers.)",
  );
}

function takeFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function formatAge(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

// Silence used-but-unused for CONNECTIONS_FILE — keeping the symbol exported
// from storage.ts for diagnostic tooling without forcing it into the runtime
// path.
void CONNECTIONS_FILE;

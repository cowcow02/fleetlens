import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, realpathSync, readFileSync } from "node:fs";
import { writePid, readPid, isProcessAlive, cleanStalePid, removePid } from "./pid.js";
import { homedir } from "node:os";
import { cclensHome, cclensPath } from "@claude-lens/parser/fs";

declare const CLI_VERSION: string;

const PID_FILE = cclensPath("pid");
const DEFAULT_PORT = 3321;

/** Resolve path to the bundled Next.js standalone server.js */
function appDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Standalone preserves monorepo structure: app/apps/web/server.js
  return join(here, "..", "app", "apps", "web");
}

/** The CLI entry as an on-disk real path. argv[1] is normally the npm bin
 *  symlink (<prefix>/bin/fleetlens); web routes derive sibling paths from
 *  FLEETLENS_CLI_BIN (…/menubar/Fleetlens.app) which only resolve
 *  from the real package location — via the symlink the widget read as
 *  "not bundled" on every normal invocation. */
function cliBinRealPath(): string {
  const argv1 = process.argv[1] ?? "";
  try {
    return realpathSync(argv1);
  } catch {
    return argv1;
  }
}

/** Version of the CLI package on disk, not the compiled CLI_VERSION.
 *  Identical for a plain start — but `fleetlens update` restarts services
 *  from the OLD process after npm has replaced the package, and the spawned
 *  server.js is the new code. Stamping the compiled constant left the pid
 *  file one version behind, so `status` warned "serving stale" forever. */
function onDiskVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? CLI_VERSION;
  } catch {
    return CLI_VERSION;
  }
}

export type ServerStatus =
  | { running: true; pid: number; port: number; version?: string }
  | { running: false };

/** ps-identity markers: Next rewrites its title to "next-server (vX)"; a
 *  pre-title-rewrite process still shows the spawned server.js argv. */
const SERVER_MARKERS = ["next-server", "server.js"];

export function getServerStatus(): ServerStatus {
  cleanStalePid(PID_FILE, SERVER_MARKERS);
  const entry = readPid(PID_FILE);
  if (entry !== null && isProcessAlive(entry.pid, SERVER_MARKERS)) {
    return { running: true, pid: entry.pid, port: entry.port ?? DEFAULT_PORT, version: entry.version };
  }
  return { running: false };
}

/**
 * A running server is stale when its recorded version differs from this
 * CLI's — or is unknown (started by a pre-versioned-pidfile install). Both
 * mean the live bundle no longer matches what the user just installed.
 */
export function isServerStale(status: ServerStatus): boolean {
  return status.running === true && status.version !== CLI_VERSION;
}

/**
 * Return a healthy server matching the current CLI version. If one is
 * already running on the right version it's reused; a stale one is stopped
 * and relaunched on the same port. This heals the drift where the CLI and
 * daemon get updated but the web server keeps serving an old (sometimes
 * broken) build until manually restarted.
 */
export async function ensureCurrentServer(
  opts: { port?: number; autoStartDaemon?: boolean } = {},
): Promise<{ pid: number; port: number; restarted: boolean; previousVersion?: string }> {
  const status = getServerStatus();
  if (status.running && !isServerStale(status)) {
    return { pid: status.pid, port: status.port, restarted: false };
  }
  if (!status.running) {
    const result = await startServer(opts);
    return { ...result, restarted: false };
  }

  // Stale server (older/unknown version) → cycle it on the same port.
  const previousVersion = status.version;
  const oldPid = status.pid;
  const port = opts.port ?? status.port;

  stopServer();
  await waitForPortFree(port, 5_000);
  // If SIGTERM didn't free the port (slow drain / ignored signal), escalate to
  // SIGKILL so the relaunch can't fail just because the old server lingered.
  if (await checkPort(port)) {
    try {
      process.kill(oldPid, "SIGKILL");
    } catch {
      // already gone
    }
    await waitForPortFree(port, 3_000);
  }

  try {
    const result = await startServer({ port, autoStartDaemon: opts.autoStartDaemon });
    return { ...result, restarted: true, previousVersion };
  } catch (err) {
    // Relaunch failed and the old server may still be alive holding the port —
    // re-stamp its pid so `status`/`stop` can still see and kill it instead of
    // leaving an untracked orphan serving the stale bundle.
    if (isProcessAlive(oldPid, SERVER_MARKERS)) writePid(PID_FILE, oldPid, port, previousVersion);
    throw err;
  }
}

export async function startServer(
  opts: { port?: number; autoStartDaemon?: boolean } = {},
): Promise<{ pid: number; port: number }> {
  const port = opts.port ?? (parseInt(process.env.CCLENS_PORT ?? "", 10) || DEFAULT_PORT);
  const serverJs = join(appDir(), "server.js");

  if (!existsSync(serverJs)) {
    throw new Error(`Server not found at ${serverJs}. Reinstall with: npm install -g fleetlens`);
  }

  // Check if port is in use
  const portInUse = await checkPort(port);
  if (portInUse) {
    throw new Error(`Port ${port} is in use. Use --port to specify a different port.`);
  }

  const dataDir = join(homedir(), ".claude", "projects");

  const child = spawn(process.execPath, [serverJs], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "localhost",
      CCLENS_DATA_DIR: dataDir,
      FLEETLENS_CLI_BIN: cliBinRealPath(),
      FLEETLENS_WEB_START_DAEMON: opts.autoStartDaemon === false ? "0" : "1",
    },
    cwd: appDir(),
  });

  child.unref();
  const pid = child.pid!;
  writePid(PID_FILE, pid, port, onDiskVersion());

  // Wait for server to be healthy. 30s, not 10: `team join` cold-starts this
  // on brand-new installs (first-ever Next boot, nothing cached) and a slow
  // machine blowing the budget gets a misleading "could not start" error
  // while the server finishes booting seconds later.
  await waitForHealth(`http://localhost:${port}/api/health`, 30_000);

  return { pid, port };
}

/** True when the server answers HTTP within `timeoutMs`. Probes /api/health,
 *  not `/` — the homepage is a full server render and a probe must not add
 *  that load (or misread a slow render) every tick. */
export async function probeServerHealth(port: number, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Replace a wedged server with a fresh one on the same port. Straight to
 *  SIGKILL: a GC-livelocked event loop never runs a SIGTERM handler — the
 *  2026-07-18 wedge survived `fleetlens stop` and needed kill -9. */
export async function restartWedgedServer(
  pid: number,
  port: number,
): Promise<{ pid: number; port: number }> {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone
  }
  removePid(PID_FILE);
  await waitForPortFree(port, 5_000);
  return startServer({ port });
}

export function stopServer(): { stopped: boolean; pid?: number } {
  cleanStalePid(PID_FILE, SERVER_MARKERS);
  const entry = readPid(PID_FILE);
  if (entry === null) {
    return { stopped: false };
  }

  try {
    process.kill(entry.pid, "SIGTERM");
  } catch {
    // Process already gone
  }
  removePid(PID_FILE);
  return { stopped: true, pid: entry.pid };
}

async function checkPort(port: number): Promise<boolean> {
  const { createServer } = await import("node:net");
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    server.listen(port, "localhost");
  });
}

async function waitForPortFree(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await checkPort(port))) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  // Fall through — startServer surfaces a clear "port in use" error if the
  // old process ignored SIGTERM and still holds the port.
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not become healthy within ${timeoutMs / 1000}s`);
}

export function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "start"
    : "xdg-open";
  spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
}

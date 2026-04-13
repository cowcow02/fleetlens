import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { writePid, readPid, isProcessAlive, cleanStalePid, removePid } from "./pid.js";
import { homedir } from "node:os";

const STATE_DIR = join(homedir(), ".cclens");
const PID_FILE = join(STATE_DIR, "pid");
const DEFAULT_PORT = 3321;

/** Resolve path to the bundled Next.js standalone server.js */
function appDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Standalone preserves monorepo structure: app/apps/web/server.js
  return join(here, "..", "app", "apps", "web");
}

export type ServerStatus =
  | { running: true; pid: number; port: number }
  | { running: false };

export function getServerStatus(): ServerStatus {
  cleanStalePid(PID_FILE);
  const entry = readPid(PID_FILE);
  if (entry !== null && isProcessAlive(entry.pid)) {
    return { running: true, pid: entry.pid, port: entry.port ?? DEFAULT_PORT };
  }
  return { running: false };
}

export async function startServer(opts: { port?: number } = {}): Promise<{ pid: number; port: number }> {
  const port = opts.port ?? (parseInt(process.env.CCLENS_PORT ?? "", 10) || DEFAULT_PORT);
  const serverJs = join(appDir(), "server.js");

  if (!existsSync(serverJs)) {
    throw new Error(`Server not found at ${serverJs}. Reinstall with: npm install -g cclens`);
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
    },
    cwd: appDir(),
  });

  child.unref();
  const pid = child.pid!;
  writePid(PID_FILE, pid, port);

  // Wait for server to be healthy
  await waitForHealth(`http://localhost:${port}`, 10_000);

  return { pid, port };
}

export function stopServer(): { stopped: boolean; pid?: number } {
  cleanStalePid(PID_FILE);
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

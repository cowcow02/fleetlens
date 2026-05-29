import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";

const execFileAsync = promisify(execFile);

const MAC_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Arc.app/Contents/MacOS/Arc",
];

const LINUX_CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
  "/usr/bin/brave-browser",
  "/snap/bin/chromium",
];

const WIN_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
];

// Memoize the resolved promise so the PATH-fallback shell-out only ever runs
// once per process. Subsequent callers (or concurrent ones) share the result.
let cached: Promise<string | null> | undefined;

export function findChrome(): Promise<string | null> {
  if (cached === undefined) cached = resolveChrome();
  return cached;
}

async function resolveChrome(): Promise<string | null> {
  if (process.env.FLEETLENS_CHROME_PATH && existsSync(process.env.FLEETLENS_CHROME_PATH)) {
    return process.env.FLEETLENS_CHROME_PATH;
  }

  const candidates =
    process.platform === "darwin" ? MAC_CANDIDATES
    : process.platform === "win32" ? WIN_CANDIDATES
    : LINUX_CANDIDATES;

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  // Last resort: ask the shell. Works for nix-installed chromium etc. Async
  // so the first PDF request doesn't block the event loop while which/where
  // runs (a few hundred ms on systems with no Chrome at a known path).
  const lookup = process.platform === "win32" ? "where" : "which";
  for (const name of ["google-chrome", "chromium", "chromium-browser", "brave-browser"]) {
    try {
      const { stdout } = await execFileAsync(lookup, [name], { encoding: "utf8" });
      const found = stdout.trim().split("\n")[0];
      if (found && existsSync(found)) return found;
    } catch { /* keep trying */ }
  }

  return null;
}

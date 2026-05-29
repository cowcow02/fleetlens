import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import process from "node:process";

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

let cached: string | null | undefined;

export function findChrome(): string | null {
  if (cached !== undefined) return cached;

  if (process.env.FLEETLENS_CHROME_PATH && existsSync(process.env.FLEETLENS_CHROME_PATH)) {
    cached = process.env.FLEETLENS_CHROME_PATH;
    return cached;
  }

  const candidates =
    process.platform === "darwin" ? MAC_CANDIDATES
    : process.platform === "win32" ? WIN_CANDIDATES
    : LINUX_CANDIDATES;

  for (const p of candidates) {
    if (existsSync(p)) {
      cached = p;
      return cached;
    }
  }

  // Last resort: ask the shell. Works for nix-installed chromium etc.
  for (const name of ["google-chrome", "chromium", "chromium-browser", "brave-browser"]) {
    try {
      const out = execFileSync(process.platform === "win32" ? "where" : "which", [name], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim().split("\n")[0];
      if (out && existsSync(out)) {
        cached = out;
        return cached;
      }
    } catch { /* keep trying */ }
  }

  cached = null;
  return null;
}

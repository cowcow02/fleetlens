import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

// Mirrors packages/cli/src/commands/menubar.ts state (~/Applications bundle
// presence + running process + bundled-in-CLI presence). Reads only — every
// mutation shells out to the CLI so the install/login-item logic stays in one
// place (same model as lib/autostart-data.ts).

const APP_BUNDLE = "FleetlensMenubar.app";
const BUNDLE_EXEC = "FleetlensMenubar";
const INSTALLED_PATH = join(homedir(), "Applications", APP_BUNDLE);

export type MenubarState = {
  supported: boolean;
  installed: boolean;
  running: boolean;
  bundled: boolean;
};

/** Path to the .app shipped inside the npm package, derived from the CLI bin
 *  the server was handed via FLEETLENS_CLI_BIN. Null in `pnpm dev` (no env). */
function bundledAppPath(): string | null {
  const bin = process.env.FLEETLENS_CLI_BIN;
  if (!bin) return null;
  return join(dirname(bin), "..", "menubar", APP_BUNDLE);
}

function isRunning(): boolean {
  if (process.platform !== "darwin") return false;
  try {
    const out = execFileSync("pgrep", ["-x", BUNDLE_EXEC], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2_000,
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

export function readMenubarState(): MenubarState {
  const supported = process.platform === "darwin";
  const installed = supported && existsSync(INSTALLED_PATH);
  const bundledPath = bundledAppPath();
  const bundled = supported && !!bundledPath && existsSync(bundledPath);
  return { supported, installed, running: installed && isRunning(), bundled };
}

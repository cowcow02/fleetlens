import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { cclensPath } from "@claude-lens/parser/fs";

const execFileAsync = promisify(execFile);

/** launchd job label + the LaunchAgent file it owns. */
const LABEL = "com.fleetlens.daemon";
const NON_MAC_MSG =
  "autostart uses a macOS launchd LaunchAgent and is macOS-only for now. " +
  "On other platforms, add `fleetlens daemon start` to your login items manually.";

function plistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

function isMac(): boolean {
  return process.platform === "darwin";
}

/** True when the LaunchAgent plist exists (macOS only). */
export function isAutostartInstalled(): boolean {
  return isMac() && existsSync(plistPath());
}

/** Absolute path to the running CLI entry (dist/index.js), resolved through
 *  the `fleetlens` bin symlink. launchd runs with no shell PATH, so the plist
 *  must reference absolute paths — never the `fleetlens` command name. */
function resolveScriptPath(): string {
  const argv1 = process.argv[1] ?? "";
  try {
    return realpathSync(argv1);
  } catch {
    return argv1;
  }
}

/**
 * Build the LaunchAgent plist. RunAtLoad runs `fleetlens daemon start` once at
 * login; the existing detached, self-updating daemon takes over from there.
 * Deliberately NO KeepAlive — the daemon self-updates (6h check → npm i -g →
 * re-exec), and a KeepAlive supervisor would fight that teardown/re-exec and
 * thrash (or spawn a second daemon). Run-once-at-login is exactly enough to
 * "survive a reboot".
 */
export function buildPlist(opts: { nodePath: string; scriptPath: string; logPath: string }): string {
  const { nodePath, scriptPath, logPath } = opts;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
    <string>daemon</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;
}

async function runLaunchctl(args: string[]): Promise<void> {
  await execFileAsync("launchctl", args);
}

/** Write + load the LaunchAgent. Returns false on non-mac (with a message). */
export async function installAutostart(): Promise<boolean> {
  if (!isMac()) {
    console.log(NON_MAC_MSG);
    return false;
  }
  const nodePath = process.execPath;
  const scriptPath = resolveScriptPath();
  const logPath = cclensPath("daemon-autostart.log");
  const p = plistPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, buildPlist({ nodePath, scriptPath, logPath }), "utf8");
  // Reload so it takes effect now: unload any prior copy (ignore errors), then
  // load -w (the -w persists the "enabled" state across reboots).
  await runLaunchctl(["unload", p]).catch(() => {});
  await runLaunchctl(["load", "-w", p]);
  console.log("Autostart installed — the Fleetlens usage daemon will start at login.");
  console.log(`  LaunchAgent: ${p}`);
  console.log(`  Runs:        ${nodePath} ${scriptPath} daemon start`);
  console.log(
    "  Note: the Node path above is baked in. If you upgrade or switch Node (e.g. via nvm), re-run `fleetlens autostart install`.",
  );
  return true;
}

async function uninstallAutostart(): Promise<void> {
  if (!isMac()) {
    console.log(NON_MAC_MSG);
    return;
  }
  const p = plistPath();
  if (!existsSync(p)) {
    console.log("Autostart is not installed — nothing to remove.");
    return;
  }
  await runLaunchctl(["unload", "-w", p]).catch(() => {});
  rmSync(p, { force: true });
  console.log(`Autostart removed (${p}). The daemon will no longer start at login.`);
}

async function statusAutostart(): Promise<void> {
  if (!isMac()) {
    console.log("Autostart: macOS-only (not available on this platform).");
    return;
  }
  const p = plistPath();
  const present = existsSync(p);
  let loaded = false;
  try {
    const { stdout } = await execFileAsync("launchctl", ["list"]);
    loaded = stdout.includes(LABEL);
  } catch {
    // launchctl missing/!mac — leave loaded=false.
  }
  console.log(`Autostart: ${present ? "installed" : "not installed"}${present ? ` (${p})` : ""}`);
  console.log(`launchd:   ${loaded ? "loaded" : "not loaded"}`);
}

// ─── "don't ask again" flag for the start-time prompt ──────────────────────

function promptFlagPath(): string {
  return cclensPath("autostart.json");
}

export function isPromptDismissed(): boolean {
  try {
    const j = JSON.parse(readFileSync(promptFlagPath(), "utf8")) as { promptDismissed?: boolean };
    return j.promptDismissed === true;
  } catch {
    return false;
  }
}

export function dismissPrompt(): void {
  const p = promptFlagPath();
  try {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ promptDismissed: true }, null, 2), "utf8");
  } catch {
    // best-effort — worst case we ask again next time.
  }
}

function promptYesNo(question: string, defaultYes: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === "") return resolve(defaultYes);
      resolve(a === "y" || a === "yes");
    });
  });
}

/**
 * Offer to install autostart on `fleetlens start`. Best-effort and entirely
 * skippable: only fires on macOS, on a real interactive TTY, when the daemon
 * was actually started, when not already installed, and when the user hasn't
 * said "don't ask again". Never throws into the start path.
 */
export async function maybePromptAutostart(opts: { daemonStarted: boolean }): Promise<void> {
  try {
    if (!isMac()) return;
    if (!opts.daemonStarted) return;
    if (process.env.__FLEETLENS_UPDATED) return; // post-update re-exec — not interactive intent
    if (!process.stdin.isTTY) return;
    if (isAutostartInstalled()) return;
    if (isPromptDismissed()) return;

    console.log("");
    console.log("Tip: keep the Fleetlens usage daemon running after you restart your Mac?");
    console.log("     This installs a launchd LaunchAgent that runs `fleetlens daemon start`");
    console.log("     at login (daemon only — not the dashboard server).");
    const yes = await promptYesNo("Set that up now? [Y/n] ", true);
    if (yes) {
      await installAutostart();
      return;
    }
    const dismiss = await promptYesNo("OK. Don't ask again? [y/N] ", false);
    if (dismiss) {
      dismissPrompt();
      console.log("Got it — I won't ask again. Run `fleetlens autostart install` anytime.");
    }
  } catch {
    // A failed prompt must never break `start`.
  }
}

export async function autostart(args: string[]): Promise<void> {
  const sub = args[0] ?? "status";
  switch (sub) {
    case "install":
      await installAutostart();
      break;
    case "uninstall":
    case "remove":
      await uninstallAutostart();
      break;
    case "status":
      await statusAutostart();
      break;
    case "help":
    case "--help":
    case "-h":
      console.log("Usage: fleetlens autostart <install|uninstall|status>");
      break;
    default:
      console.error(
        `Unknown autostart subcommand: ${sub}\nUsage: fleetlens autostart <install|uninstall|status>`,
      );
      process.exit(1);
  }
}

import { existsSync, mkdirSync, cpSync, rmSync, readdirSync, writeFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cclensPath } from "@claude-lens/parser/fs";

const execFileAsync = promisify(execFile);

const APP_BUNDLE = "Fleetlens.app";
const LEGACY_APP_BUNDLE = "FleetlensMenubar.app";
const BUNDLE_EXEC = "FleetlensMenubar";
const NON_MAC_MSG =
  "The Fleetlens menu bar widget is a native macOS app and is macOS-only. " +
  "On Linux/Windows, keep using the dashboard at the printed URL.";

function isMac(): boolean {
  return process.platform === "darwin";
}

/**
 * Where the .app ships inside the npm package. `dist/index.js` and
 * `menubar/Fleetlens.app` are siblings under `packages/cli/`, so from
 * this file's bundled location we go up one to reach the package root — same
 * resolution trick `server.ts:appDir()` uses for the Next.js standalone.
 */
function bundledAppPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "menubar", APP_BUNDLE);
}

/** Absolute path to dist/index.js, resolved through the bin symlink. */
function resolveScriptPath(): string {
  const argv1 = process.argv[1] ?? "";
  try {
    return realpathSync(argv1);
  } catch {
    return argv1;
  }
}

/**
 * Persist node + script paths so the GUI widget can spawn a fresh usage poll
 * (`node <script> usage --save`). GUI apps launched via `open` don't inherit
 * the user's shell PATH, so they can't find node or fleetlens on their own.
 */
function writeCliLaunchFile(): void {
  try {
    writeFileSync(
      cclensPath("cli-launch.json"),
      JSON.stringify({ node: process.execPath, script: resolveScriptPath() }),
      "utf8",
    );
  } catch {
    // best-effort — the widget's refresh just re-reads the file without it.
  }
}

/** User-local install location. `~/Applications` is the conventional,
 *  no-sudo home for per-user GUI apps and survives macOS upgrades. */
function installedAppPath(): string {
  return join(homedir(), "Applications", APP_BUNDLE);
}

function legacyInstalledAppPath(): string {
  return join(homedir(), "Applications", LEGACY_APP_BUNDLE);
}

/** True when the bundle exec is running. Uses pgrep -x (exact match) so a
 *  stray "FleetlensMenubarHelper" never reads as "running". */
async function isRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-x", BUNDLE_EXEC]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function launchApp(path: string): Promise<void> {
  await execFileAsync("open", ["-a", path]);
}

async function quitApp(): Promise<void> {
  // osascript sends a proper AppleEvent so the app shuts down cleanly;
  // `killall` would bypass any teardown. Ignore failures (not running).
  await execFileAsync("osascript", ["-e", `tell application "${BUNDLE_EXEC}" to quit`]).catch(
    () => {},
  );
  // Belt-and-braces for the case where the process name diverges from the
  // AppleScript target (helper processes etc.).
  await execFileAsync("pkill", ["-x", BUNDLE_EXEC]).catch(() => {});
}

/**
 * Register/unregister a login item via System Events. osascript may prompt
 * for Automation permission the first time; we treat any failure as
 * non-fatal — the app is already installed and launchable, login-item is a
 * convenience on top.
 */
async function setLoginItem(enabled: boolean, appPath: string): Promise<void> {
  const script = enabled
    ? `tell application "System Events" to make login item at end with properties {path:"${appPath}", hidden:false}`
    : `tell application "System Events" to delete login item "${APP_BUNDLE.replace(".app", "")}"`;
  await execFileAsync("osascript", ["-e", script]).catch(() => {});
}

async function removeLoginItem(name: string): Promise<void> {
  await execFileAsync("osascript", [
    "-e",
    `tell application "System Events" to delete login item "${name}"`,
  ]).catch(() => {});
}

async function installMenubar(opts: { open: boolean; login: boolean }): Promise<void> {
  if (!isMac()) {
    console.log(NON_MAC_MSG);
    return;
  }
  const src = bundledAppPath();
  if (!existsSync(src)) {
    console.error(
      `Bundled widget not found at ${src}.\n` +
        "This install was probably built without the menubar artifact. " +
        "Run `bash apps/menubar/build-app.sh && cp -R apps/menubar/dist/Fleetlens.app packages/cli/menubar/` and rebuild.",
    );
    process.exit(1);
  }

  const destDir = join(homedir(), "Applications");
  mkdirSync(destDir, { recursive: true });
  const dest = installedAppPath();

  // Stop any older copy first so the codesign/inode swap doesn't leave a
  // zombie holding the menu bar item.
  if (await isRunning()) {
    console.log("Stopping the running widget…");
    await quitApp();
    await new Promise((r) => setTimeout(r, 400));
  }

  rmSync(dest, { recursive: true, force: true });
  rmSync(legacyInstalledAppPath(), { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  writeCliLaunchFile();
  console.log(`Installed → ${dest}`);

  await removeLoginItem(APP_BUNDLE.replace(".app", ""));
  await removeLoginItem(LEGACY_APP_BUNDLE.replace(".app", ""));
  if (opts.login) {
    await setLoginItem(true, dest);
    console.log("Login item enabled (launches at login).");
  }

  if (opts.open) {
    await launchApp(dest);
    console.log("Opened — check your menu bar (gauge icon on the right side).");
  } else {
    console.log(`Launch with:  open -a "${dest}"`);
  }
}

async function uninstallMenubar(): Promise<void> {
  if (!isMac()) {
    console.log(NON_MAC_MSG);
    return;
  }
  await setLoginItem(false, installedAppPath());
  await removeLoginItem(LEGACY_APP_BUNDLE.replace(".app", ""));
  if (await isRunning()) {
    console.log("Quitting the running widget…");
    await quitApp();
    await new Promise((r) => setTimeout(r, 300));
  }
  const dest = installedAppPath();
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
    console.log(`Removed ${dest}`);
  } else {
    console.log("Widget is not installed — nothing to remove.");
  }
  rmSync(legacyInstalledAppPath(), { recursive: true, force: true });
  console.log("Login item cleared (if it was set).");
}

async function openMenubar(): Promise<void> {
  if (!isMac()) {
    console.log(NON_MAC_MSG);
    return;
  }
  const dest = installedAppPath();
  if (!existsSync(dest)) {
    console.log("Widget not installed yet. Run `fleetlens menubar install` first.");
    return;
  }
  if (await isRunning()) {
    console.log("Widget is already running.");
    return;
  }
  await launchApp(dest);
  console.log("Opened — check your menu bar.");
}

async function statusMenubar(): Promise<void> {
  if (!isMac()) {
    console.log(`Menu bar widget: macOS-only (not available on ${process.platform}).`);
    return;
  }
  const dest = installedAppPath();
  const installed = existsSync(dest);
  const running = await isRunning();
  const bundled = existsSync(bundledAppPath());
  console.log(`Menu bar widget: ${installed ? "installed" : "not installed"}${installed ? ` (${dest})` : ""}`);
  console.log(`Running:         ${running ? "yes" : "no"}`);
  console.log(`Bundled in CLI:  ${bundled ? "yes" : "no — this build ships without the widget"}`);
  if (installed) {
    try {
      const apps = readdirSync(join(homedir(), "Applications"));
      const ours = apps.find((a) => a === APP_BUNDLE);
      console.log(`App bundle:      ${ours ? "present in ~/Applications" : "missing"}`);
    } catch {
      // ignore
    }
  }
}

export async function menubar(args: string[]): Promise<void> {
  const sub = args[0] ?? "status";
  const flags = args.slice(1);
  const noOpen = flags.includes("--no-open");
  const noLogin = flags.includes("--no-login");

  switch (sub) {
    case "install": {
      // Default: open + register login item. `--no-open` to install quietly,
      // `--no-login` to skip the login-item hook.
      await installMenubar({ open: !noOpen, login: !noLogin });
      break;
    }
    case "uninstall":
    case "remove":
      await uninstallMenubar();
      break;
    case "open":
    case "start":
      await openMenubar();
      break;
    case "stop":
    case "quit":
      if (await isRunning()) {
        await quitApp();
        console.log("Stopped.");
      } else {
        console.log("Widget is not running.");
      }
      break;
    case "status":
      await statusMenubar();
      break;
    case "help":
    case "--help":
    case "-h":
      console.log(`Usage: fleetlens menubar <install|uninstall|open|stop|status>

  install [--no-open] [--no-login]   Copy the native macOS menu bar widget to
                                     ~/Applications and launch it. Registers a
                                     login item by default.
  uninstall                          Quit + remove the widget, clear login item.
  open                               Launch the installed widget.
  stop                               Quit the running widget.
  status                             Show install/running/bundled state.

The widget tails ~/.cclens/usage.jsonl and shows live Claude Code / Codex
plan utilization in the menu bar. It starts the usage daemon when launched
and re-checks it whenever you open the popover. Click "Dashboard" to open
http://localhost:3321.`);
      break;
    default:
      console.error(
        `Unknown menubar subcommand: ${sub}\nUsage: fleetlens menubar <install|uninstall|open|stop|status>`,
      );
      process.exit(1);
  }
}

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

declare const CLI_VERSION: string;

const PACKAGE_NAME = "fleetlens";
const CHECK_TIMEOUT_MS = 3_000;

/** Simple semver comparison. Returns true if remote > local. */
export function shouldUpdate(local: string, remote: string): boolean {
  const l = local.split(".").map(Number);
  const r = remote.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] ?? 0) > (l[i] ?? 0)) return true;
    if ((r[i] ?? 0) < (l[i] ?? 0)) return false;
  }
  return false;
}

/** Fetch latest version from npm registry. Returns null on failure. */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    const res = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/** Run npm install -g to update. Returns true on success. */
function runNpmInstall(): boolean {
  try {
    execSync(`npm install -g ${PACKAGE_NAME}@latest`, {
      stdio: "pipe",
      timeout: 60_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * After running npm install -g, ask npm where its global prefix is and
 * read the installed package.json to confirm what actually landed on
 * disk. Then compare with the currently-running binary path so we can
 * warn about the classic multi-node-install PATH mismatch.
 */
type InstallVerification =
  | { ok: true; installedVersion: string; installedPath: string }
  | { ok: false; reason: string };

function verifyInstalledVersion(): InstallVerification {
  try {
    const globalRoot = execSync("npm root -g", {
      encoding: "utf8",
      timeout: 5_000,
    }).trim();
    const pkgPath = join(globalRoot, PACKAGE_NAME, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version?: string;
    };
    if (!pkg.version) {
      return { ok: false, reason: `no version field in ${pkgPath}` };
    }
    return {
      ok: true,
      installedVersion: pkg.version,
      installedPath: join(globalRoot, PACKAGE_NAME),
    };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

/** Find which `fleetlens` binary PATH currently resolves to, or null. */
function currentBinaryPath(): string | null {
  try {
    const cmd = process.platform === "win32" ? "where" : "command -v";
    return execSync(`${cmd} ${PACKAGE_NAME}`, {
      encoding: "utf8",
      timeout: 3_000,
    }).trim().split("\n")[0] || null;
  } catch {
    return null;
  }
}

/**
 * Print a post-install report explaining what was installed where and
 * whether the user's shell is likely to pick up the new version. This
 * turns the confusing "Updated to X.Y.Z but --version still says old"
 * situation into an explicit, actionable message.
 */
function reportInstallOutcome(expectedLatest: string): void {
  const verify = verifyInstalledVersion();
  if (!verify.ok) {
    console.log(
      `\nnpm install succeeded, but I couldn't verify the installed version`,
    );
    console.log(`  (${verify.reason})`);
    console.log(
      `  → Run 'fleetlens --version' in a new shell to confirm.`,
    );
    return;
  }

  console.log(
    `\nInstalled: ${PACKAGE_NAME}@${verify.installedVersion}  at ${verify.installedPath}`,
  );

  if (verify.installedVersion !== expectedLatest) {
    console.warn(
      `  ⚠  Expected ${expectedLatest} but got ${verify.installedVersion} — npm may have cached an older tarball.`,
    );
  }

  // Compare with the currently-running process's PATH resolution so we
  // can warn about the "multiple node installs, wrong PATH" trap.
  //
  // The tricky bit: `which fleetlens` returns the bin SYMLINK path
  // (e.g. `<prefix>/bin/fleetlens`), while `npm root -g` returns the
  // package dir (`<prefix>/lib/node_modules/fleetlens`). Those are
  // siblings, not parent/child — a naive `startsWith` check yields a
  // false positive on every normal install. We have to follow the
  // symlink (realpath) and see if it lands inside the package dir.
  const pathResolved = currentBinaryPath();
  const sameInstall = pathResolved
    ? resolvesIntoPackage(pathResolved, verify.installedPath)
    : true; // no 'which' result → don't warn, we can't compare

  if (!sameInstall && pathResolved) {
    console.warn(
      `\n⚠  Your shell resolves '${PACKAGE_NAME}' to a DIFFERENT install:`,
    );
    console.warn(`    PATH target:   ${pathResolved}`);
    console.warn(`    Just installed: ${verify.installedPath}`);
    console.warn(
      `  This usually means you have multiple Node installs (nvm, homebrew,`,
    );
    console.warn(`  system). Start a new shell from the matching Node env, or:`);
    console.warn(`    • run 'hash -r' (zsh/bash) to clear the command cache`);
    console.warn(`    • check 'which -a ${PACKAGE_NAME}' to see all copies`);
    console.warn(
      `    • reinstall in the correct Node env: 'npm install -g ${PACKAGE_NAME}@latest'`,
    );
  } else if (verify.installedVersion !== CLI_VERSION) {
    // Only print the "next invocation" hint when a real upgrade landed
    // — reinstalling the same version is a no-op to the user.
    console.log(
      `  → This process is still running ${CLI_VERSION}. Next invocation will use ${verify.installedVersion}.`,
    );
  }
}

/**
 * Return true if `binPath` (typically `<prefix>/bin/<pkg>`, a symlink)
 * ultimately resolves into `packagePath` (the npm package dir). Handles
 * the normal layout where bin is a symlink into the package, and the
 * less common Windows shim layout where it isn't.
 */
function resolvesIntoPackage(binPath: string, packagePath: string): boolean {
  // Follow symlinks — on Unix, the bin entry is symlinked to a file
  // INSIDE packagePath.
  try {
    const real = realpathSync(binPath);
    if (real.startsWith(packagePath)) return true;
  } catch {
    // realpath failed — fall through to prefix comparison
  }
  // Fallback: compare the npm prefix inferred from each path.
  //   <prefix>/bin/<pkg>                    → prefix = dirname × 2
  //   <prefix>/lib/node_modules/<pkg>       → prefix = dirname × 3
  const binPrefix = dirname(dirname(binPath));
  const installPrefix = dirname(dirname(dirname(packagePath)));
  return binPrefix === installPrefix;
}

/**
 * Re-exec the CLI with the same arguments (after update). Prefers the
 * freshly-installed binary at `<npm root -g>/<pkg>/dist/index.js` if we
 * can find it — this bypasses PATH/shell-hash issues and guarantees the
 * next run really is the new version, even when the user has multiple
 * Node installs.
 */
function reExec(): never {
  const verify = verifyInstalledVersion();
  // Default: re-run whatever this process was launched as.
  let script = process.argv[1] ?? "";
  if (verify.ok) {
    const candidate = join(verify.installedPath, "dist", "index.js");
    if (existsSync(candidate)) script = candidate;
  }
  const result = spawnSync(process.argv[0], [script, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, __FLEETLENS_UPDATED: "1" },
  });
  process.exit(result.status ?? 0);
}

/**
 * Returns true if the CLI is running from a local development path
 * (i.e., not a global npm install). Skip auto-update in dev mode.
 */
function isDevMode(): boolean {
  // When running via `node packages/cli/dist/index.js`, argv[1] is a local path.
  // Global installs go through a shim in the npm prefix bin directory.
  const script = process.argv[1] ?? "";
  return script.includes("packages/cli/") || script.includes("packages\\cli\\");
}

/**
 * Check for updates and auto-apply if a newer version exists.
 * Called at the start of `fleetlens start`.
 */
export async function checkForUpdate(): Promise<void> {
  if (isDevMode()) return; // skip in local dev
  // Legacy __CCLENS_UPDATED kept for backward compat with older installs
  // that re-exec after self-update.
  if (
    process.env.__FLEETLENS_UPDATED === "1" ||
    process.env.__CCLENS_UPDATED === "1"
  ) return;

  const latest = await fetchLatestVersion();
  if (latest === null) return; // offline or error

  const current = CLI_VERSION;
  if (!shouldUpdate(current, latest)) return;

  console.log(`Updating ${PACKAGE_NAME} ${current} → ${latest}...`);

  // Tear down any running server + daemon BEFORE installing so the
  // re-exec brings up a fresh set of processes against the new code.
  // Without this, `fleetlens start` on top of an already-running older
  // server would update the binary but leave the old web server alive
  // and serving stale code.
  await stopRunningServices();

  const ok = runNpmInstall();
  if (ok) {
    reportInstallOutcome(latest);
    console.log("\nRestarting with the new version...");
    reExec();
  } else {
    console.warn(
      `Update failed. Starting with current version.\n` +
        `  → Try manually: npm install -g ${PACKAGE_NAME}@latest\n` +
        `  → Or with sudo if your global npm prefix needs it.`,
    );
  }
}

type RunningState = {
  serverWasRunning: boolean;
  serverPort: number | null;
  daemonWasRunning: boolean;
};

/**
 * Stop the web server and usage daemon if either is running, printing
 * a short report so the user can follow along. Used by the auto-update
 * flow so a version bump always lands on fresh processes.
 *
 * Returns the state of each service BEFORE it was stopped, so the
 * caller (update command) can bring them back up with the same port
 * after the new version is installed.
 */
async function stopRunningServices(): Promise<RunningState> {
  const state: RunningState = {
    serverWasRunning: false,
    serverPort: null,
    daemonWasRunning: false,
  };

  try {
    const { getServerStatus, stopServer } = await import("./server.js");
    const status = getServerStatus();
    if (status.running) {
      state.serverWasRunning = true;
      state.serverPort = status.port;
      stopServer();
      console.log(`  ✓ Stopped old server (PID ${status.pid})`);
    }
  } catch {
    // Non-fatal — don't block the upgrade if stop fails.
  }
  try {
    const { stopDaemonSilent } = await import("./commands/daemon.js");
    const result = stopDaemonSilent();
    if (result.stopped) {
      state.daemonWasRunning = true;
      console.log(`  ✓ Stopped old daemon (PID ${result.pid})`);
    }
  } catch {
    // Non-fatal
  }

  return state;
}

/**
 * Bring the web server and usage daemon back up after an in-place
 * update. Only restarts services that were actually running before
 * the teardown — a user who runs `fleetlens update` without a dashboard
 * open isn't asking for one to launch. Used by forceUpdate so the
 * explicit `fleetlens update` command can self-heal a running setup.
 *
 * The helpers here are the CURRENT process's startServer / daemon
 * helpers, but on disk the files they spawn (server.js, daemon-worker.js)
 * have already been replaced by npm install — so the children that
 * actually come up are the NEW version.
 */
async function restartServices(state: RunningState): Promise<void> {
  if (!state.serverWasRunning && !state.daemonWasRunning) return;

  if (state.serverWasRunning) {
    try {
      const { startServer } = await import("./server.js");
      const result = await startServer({ port: state.serverPort ?? undefined });
      console.log(
        `  ✓ Restarted server on http://localhost:${result.port} (PID ${result.pid})`,
      );
    } catch (err) {
      console.warn(
        `  ! Could not restart server: ${(err as Error).message}\n    Run 'fleetlens start' manually.`,
      );
    }
  }

  if (state.daemonWasRunning) {
    try {
      const { startDaemonSilent } = await import("./commands/daemon.js");
      const result = startDaemonSilent();
      if (result.started) {
        console.log(`  ✓ Restarted daemon (PID ${result.pid})`);
      } else if (result.alreadyRunning) {
        console.log(`  ✓ Daemon already running (PID ${result.pid})`);
      } else {
        console.warn(`  ! Could not restart daemon: ${result.error}`);
      }
    } catch (err) {
      console.warn(
        `  ! Could not restart daemon: ${(err as Error).message}\n    Run 'fleetlens daemon start' manually.`,
      );
    }
  }
}

/**
 * Force update — always attempts install regardless of version.
 *
 * Behavior:
 *   - Same version: reinstall in place, don't touch running services.
 *   - Real upgrade: stop running services, install new version, then
 *     bring services back up with the new code (matching the state
 *     they were in before the update). No manual restart required.
 */
export async function forceUpdate(): Promise<void> {
  const latest = await fetchLatestVersion();
  const current = CLI_VERSION;

  if (latest === null) {
    console.error("Could not reach npm registry. Check your network.");
    process.exit(1);
  }

  const isRealUpgrade = shouldUpdate(current, latest);
  let priorState: RunningState | null = null;

  if (isRealUpgrade) {
    console.log(`Updating ${PACKAGE_NAME} ${current} → ${latest}...`);
    // Capture what was running and stop it so the new version lands on
    // a clean slate. We'll bring back whatever was alive.
    priorState = await stopRunningServices();
  } else {
    console.log(`Already on latest (${current}). Reinstalling...`);
  }

  // Always attempt install (useful if installation is corrupted)
  const ok = runNpmInstall();
  if (!ok) {
    console.error("Update failed.");
    console.error(`  → Try manually: npm install -g ${PACKAGE_NAME}@latest`);
    console.error(`  → Or with sudo if your global npm prefix needs it.`);
    process.exit(1);
  }

  reportInstallOutcome(latest);

  // If this was a real upgrade and services were running before, bring
  // them back up against the new code.
  if (isRealUpgrade && priorState) {
    if (priorState.serverWasRunning || priorState.daemonWasRunning) {
      console.log("");
      await restartServices(priorState);
    }
  }
}

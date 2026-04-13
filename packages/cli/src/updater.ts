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
  } else {
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

/**
 * Force update — always attempts install regardless of version.
 */
export async function forceUpdate(): Promise<void> {
  const latest = await fetchLatestVersion();
  const current = CLI_VERSION;

  if (latest === null) {
    console.error("Could not reach npm registry. Check your network.");
    process.exit(1);
  }

  if (shouldUpdate(current, latest)) {
    console.log(`Updating ${PACKAGE_NAME} ${current} → ${latest}...`);
  } else {
    console.log(`Already on latest (${current}). Reinstalling...`);
  }

  // Always attempt install (useful if installation is corrupted)
  const ok = runNpmInstall();
  if (ok) {
    reportInstallOutcome(latest);
  } else {
    console.error("Update failed.");
    console.error(`  → Try manually: npm install -g ${PACKAGE_NAME}@latest`);
    console.error(`  → Or with sudo if your global npm prefix needs it.`);
    process.exit(1);
  }
}

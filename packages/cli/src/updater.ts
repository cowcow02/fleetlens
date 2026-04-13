import { execSync, spawnSync } from "node:child_process";

declare const CLI_VERSION: string;

const PACKAGE_NAME = "cclens";
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

/** Re-exec the CLI with the same arguments (after update). */
function reExec(): never {
  const result = spawnSync(process.argv[0], process.argv.slice(1), {
    stdio: "inherit",
    env: { ...process.env, __CCLENS_UPDATED: "1" },
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
 * Called at the start of `cclens start`.
 */
export async function checkForUpdate(): Promise<void> {
  if (isDevMode()) return; // skip in local dev
  if (process.env.__CCLENS_UPDATED === "1") return; // prevent re-exec loop

  const latest = await fetchLatestVersion();
  if (latest === null) return; // offline or error

  const current = CLI_VERSION;
  if (!shouldUpdate(current, latest)) return;

  console.log(`Updating cclens ${current} → ${latest}...`);
  const ok = runNpmInstall();
  if (ok) {
    console.log("Updated successfully. Restarting...");
    reExec();
  } else {
    console.warn("Update failed. Starting with current version.");
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
    console.log(`Updating cclens ${current} → ${latest}...`);
  } else {
    console.log(`Already on latest (${current}). Reinstalling...`);
  }

  // Always attempt install (useful if installation is corrupted)
  const ok = runNpmInstall();
  if (ok) {
    console.log(shouldUpdate(current, latest) ? `Updated to ${latest}.` : "Reinstall complete.");
  } else {
    console.error("Update failed.");
    process.exit(1);
  }
}

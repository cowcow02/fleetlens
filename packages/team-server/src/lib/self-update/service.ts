import { createHash } from "node:crypto";
import semver from "semver";
import { getPool } from "../../db/pool";
import { getLatestVersion } from "./version-detector";
import { getChangelog, getMigrationsManifest, type MigrationInfo } from "./changelog-fetcher";
import { getPlatformAdapter } from "./platform";

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  lastCheckedAt: Date | null;
}

// "update available" iff latest > current, ignoring dev sentinel.
function isUpdateAvailable(currentVersion: string, latestVersion: string | null): boolean {
  if (!latestVersion) return false;
  if (currentVersion === "0.0.0-dev") return false;
  return semver.gt(latestVersion, currentVersion);
}

export async function getStatus(): Promise<UpdateStatus> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT current_version, latest_version, update_available, last_checked_at FROM update_check_cache WHERE key = 'global'",
  );
  const currentVersion = process.env.APP_VERSION ?? "0.0.0-dev";
  if (!rows.length) {
    return { currentVersion, latestVersion: null, updateAvailable: false, lastCheckedAt: null };
  }
  const latestVersion: string | null = rows[0].latest_version;
  // Recompute against the *live* current version. The cached `update_available`
  // column was written when checkNow last ran and goes stale the moment the
  // image is upgraded — until the next checkNow the row still says "true" with
  // latest_version equal to the new current. Trust the versions, not the cached
  // boolean.
  return {
    currentVersion,
    latestVersion,
    updateAvailable: isUpdateAvailable(currentVersion, latestVersion),
    lastCheckedAt: rows[0].last_checked_at,
  };
}

export async function checkNow(): Promise<UpdateStatus> {
  const pool = getPool();
  const currentVersion = process.env.APP_VERSION ?? "0.0.0-dev";
  const latestVersion = await getLatestVersion();
  const updateAvailable = isUpdateAvailable(currentVersion, latestVersion);
  await pool.query(
    `INSERT INTO update_check_cache (key, current_version, latest_version, update_available, last_checked_at)
     VALUES ('global', $1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET
       current_version = EXCLUDED.current_version,
       latest_version = EXCLUDED.latest_version,
       update_available = EXCLUDED.update_available,
       last_checked_at = now()`,
    [currentVersion, latestVersion, updateAvailable],
  );
  await pool.query(
    `INSERT INTO events (action, payload) VALUES ('self_update.check', $1)`,
    [JSON.stringify({ currentVersion, latestVersion })],
  );
  return { currentVersion, latestVersion, updateAvailable, lastCheckedAt: new Date() };
}

export async function getReview(
  version: string,
): Promise<{ changelog: string; migrations: MigrationInfo[] }> {
  const pool = getPool();
  const [changelog, manifest, applied] = await Promise.all([
    getChangelog(version).catch(() => "*(Failed to fetch release notes.)*"),
    getMigrationsManifest(version).catch(() => ({ version, migrations: [] as MigrationInfo[] })),
    getAppliedMigrationHashes(pool),
  ]);
  // Manifests list every SQL file in the target version's migrations dir, not
  // just the ones added since the running version. Subtract the hashes drizzle
  // has already applied so the operator sees the actual diff. If we can't read
  // the tracking table (fresh DB, permission issue), we show every migration
  // — over-report rather than hide unapplied work.
  const unapplied = applied.size === 0
    ? manifest.migrations
    : manifest.migrations.filter(
        (m) => !applied.has(createHash("sha256").update(m.sql).digest("hex")),
      );
  return { changelog, migrations: unapplied };
}

async function getAppliedMigrationHashes(
  pool: ReturnType<typeof getPool>,
): Promise<Set<string>> {
  try {
    const r = await pool.query<{ hash: string }>(
      "SELECT hash FROM drizzle.__drizzle_migrations",
    );
    return new Set(r.rows.map((row) => row.hash));
  } catch {
    return new Set();
  }
}

export async function applyUpdate(
  version: string,
  actorId: string,
): Promise<{ revisionId: string }> {
  const adapter = getPlatformAdapter();
  if (!adapter) throw new Error("Self-update is not available on this platform");
  const latest = await getLatestVersion();
  if (latest !== version)
    throw new Error(`Target version ${version} is no longer the latest (${latest ?? "unknown"})`);

  const pool = getPool();
  const currentVersion = process.env.APP_VERSION ?? "0.0.0-dev";
  await pool.query(
    `INSERT INTO events (actor_id, action, payload) VALUES ($1, 'self_update.apply_requested', $2)`,
    [actorId, JSON.stringify({ fromVersion: currentVersion, toVersion: version })],
  );

  const result = await adapter.redeploy(version);

  await pool.query(
    `UPDATE update_check_cache SET last_update_attempt = $1 WHERE key = 'global'`,
    [JSON.stringify({ version, revisionId: result.revisionId, at: new Date().toISOString() })],
  );

  return result;
}

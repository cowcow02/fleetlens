import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDb } from "../../helpers/db.js";
import { getPool } from "../../../src/db/pool.js";

vi.mock("../../../src/lib/self-update/version-detector.js", () => ({
  getLatestVersion: vi.fn(),
}));
vi.mock("../../../src/lib/self-update/changelog-fetcher.js", () => ({
  getChangelog: vi.fn(),
  getMigrationsManifest: vi.fn(),
}));
vi.mock("../../../src/lib/self-update/platform.js", () => ({
  getPlatformAdapter: vi.fn(),
}));

const { getLatestVersion } = await import("../../../src/lib/self-update/version-detector.js");
const { getChangelog, getMigrationsManifest } = await import(
  "../../../src/lib/self-update/changelog-fetcher.js"
);
const { getPlatformAdapter } = await import("../../../src/lib/self-update/platform.js");
const { getStatus, checkNow, getReview, applyUpdate } = await import(
  "../../../src/lib/self-update/service.js"
);

const originalAppVersion = process.env.APP_VERSION;

beforeEach(async () => {
  await resetDb();
  vi.mocked(getLatestVersion).mockReset();
  vi.mocked(getChangelog).mockReset();
  vi.mocked(getMigrationsManifest).mockReset();
  vi.mocked(getPlatformAdapter).mockReset();
  process.env.APP_VERSION = "0.4.2";
});

afterEach(() => {
  if (originalAppVersion === undefined) delete process.env.APP_VERSION;
  else process.env.APP_VERSION = originalAppVersion;
});

describe("getStatus", () => {
  it("returns defaults on an empty cache (fresh DB)", async () => {
    const status = await getStatus();
    expect(status).toEqual({
      currentVersion: "0.4.2",
      latestVersion: null,
      updateAvailable: false,
      lastCheckedAt: null,
    });
  });

  it("returns the cached row when one exists", async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO update_check_cache (key, current_version, latest_version, update_available, last_checked_at)
       VALUES ('global', $1, $2, $3, now())`,
      ["0.4.2", "0.5.0", true],
    );
    const status = await getStatus();
    expect(status.currentVersion).toBe("0.4.2");
    expect(status.latestVersion).toBe("0.5.0");
    expect(status.updateAvailable).toBe(true);
    expect(status.lastCheckedAt).toBeInstanceOf(Date);
  });

  it("falls back to 0.0.0-dev when APP_VERSION is unset", async () => {
    delete process.env.APP_VERSION;
    const status = await getStatus();
    expect(status.currentVersion).toBe("0.0.0-dev");
  });

  it("recomputes updateAvailable=false when the cached latest equals the live current version", async () => {
    // Stale cache: the row was written when current was older (0.4.1) and latest
    // was 0.4.2 with update_available=true. The image has since been upgraded to
    // 0.4.2 (process.env.APP_VERSION) but checkNow hasn't run again yet.
    const pool = getPool();
    await pool.query(
      `INSERT INTO update_check_cache (key, current_version, latest_version, update_available, last_checked_at)
       VALUES ('global', $1, $2, $3, now())`,
      ["0.4.1", "0.4.2", true],
    );
    const status = await getStatus();
    expect(status.currentVersion).toBe("0.4.2");
    expect(status.latestVersion).toBe("0.4.2");
    expect(status.updateAvailable).toBe(false);
  });

  it("recomputes updateAvailable=false when the cached latest is older than the live current version", async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO update_check_cache (key, current_version, latest_version, update_available, last_checked_at)
       VALUES ('global', $1, $2, $3, now())`,
      ["0.4.1", "0.4.1", true],
    );
    const status = await getStatus();
    expect(status.updateAvailable).toBe(false);
  });

  it("recomputes updateAvailable=false on dev builds even when the cached row claims an update", async () => {
    delete process.env.APP_VERSION;
    const pool = getPool();
    await pool.query(
      `INSERT INTO update_check_cache (key, current_version, latest_version, update_available, last_checked_at)
       VALUES ('global', $1, $2, $3, now())`,
      ["0.4.1", "0.5.0", true],
    );
    const status = await getStatus();
    expect(status.currentVersion).toBe("0.0.0-dev");
    expect(status.updateAvailable).toBe(false);
  });
});

describe("checkNow", () => {
  it("writes a fresh row + event and returns update_available=true when latest > current", async () => {
    vi.mocked(getLatestVersion).mockResolvedValue("0.5.0");
    const result = await checkNow();
    expect(result.latestVersion).toBe("0.5.0");
    expect(result.updateAvailable).toBe(true);

    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT current_version, latest_version, update_available FROM update_check_cache WHERE key = 'global'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      current_version: "0.4.2",
      latest_version: "0.5.0",
      update_available: true,
    });

    const { rows: evRows } = await pool.query(
      "SELECT action, payload FROM events WHERE action = 'self_update.check'",
    );
    expect(evRows).toHaveLength(1);
    expect(evRows[0].payload).toEqual({ currentVersion: "0.4.2", latestVersion: "0.5.0" });
  });

  it("upserts on subsequent checks (single row)", async () => {
    vi.mocked(getLatestVersion).mockResolvedValueOnce("0.4.3");
    await checkNow();
    vi.mocked(getLatestVersion).mockResolvedValueOnce("0.5.0");
    await checkNow();
    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT latest_version FROM update_check_cache WHERE key = 'global'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].latest_version).toBe("0.5.0");
  });

  it("reports update_available=false when latest <= current", async () => {
    vi.mocked(getLatestVersion).mockResolvedValue("0.4.2");
    const result = await checkNow();
    expect(result.updateAvailable).toBe(false);
  });

  it("reports update_available=false on dev (0.0.0-dev) even if latest exists", async () => {
    delete process.env.APP_VERSION;
    vi.mocked(getLatestVersion).mockResolvedValue("0.5.0");
    const result = await checkNow();
    expect(result.updateAvailable).toBe(false);
  });

  it("reports update_available=false when latestVersion is null", async () => {
    vi.mocked(getLatestVersion).mockResolvedValue(null);
    const result = await checkNow();
    expect(result.latestVersion).toBeNull();
    expect(result.updateAvailable).toBe(false);
  });
});

describe("getReview", () => {
  it("returns changelog + migrations from the fetchers", async () => {
    vi.mocked(getChangelog).mockResolvedValue("## v0.5.0\n- Added");
    vi.mocked(getMigrationsManifest).mockResolvedValue({
      version: "0.5.0",
      migrations: [
        { filename: "0001.sql", description: "add table", sql: "CREATE TABLE t ()" },
      ],
    });
    const review = await getReview("0.5.0");
    expect(review.changelog).toContain("v0.5.0");
    expect(review.migrations).toHaveLength(1);
    expect(review.migrations[0].filename).toBe("0001.sql");
  });

  it("tolerates a failing changelog fetch with a friendly placeholder", async () => {
    vi.mocked(getChangelog).mockRejectedValue(new Error("boom"));
    vi.mocked(getMigrationsManifest).mockResolvedValue({ version: "0.5.0", migrations: [] });
    const review = await getReview("0.5.0");
    expect(review.changelog).toContain("Failed to fetch release notes");
    expect(review.migrations).toEqual([]);
  });

  it("tolerates a failing manifest fetch with an empty migrations list", async () => {
    vi.mocked(getChangelog).mockResolvedValue("notes");
    vi.mocked(getMigrationsManifest).mockRejectedValue(new Error("nope"));
    const review = await getReview("0.5.0");
    expect(review.changelog).toBe("notes");
    expect(review.migrations).toEqual([]);
  });
});

describe("applyUpdate", () => {
  it("throws when no platform adapter is available", async () => {
    vi.mocked(getPlatformAdapter).mockReturnValue(null);
    vi.mocked(getLatestVersion).mockResolvedValue("0.5.0");
    await expect(applyUpdate("0.5.0", "00000000-0000-0000-0000-000000000001")).rejects.toThrow(
      /not available/,
    );
  });

  it("rejects a stale target version that no longer matches latest", async () => {
    vi.mocked(getPlatformAdapter).mockReturnValue({
      name: "railway",
      getCurrentImage: vi.fn(),
      redeploy: vi.fn(),
    });
    vi.mocked(getLatestVersion).mockResolvedValue("0.6.0");
    await expect(applyUpdate("0.5.0", "00000000-0000-0000-0000-000000000001")).rejects.toThrow(
      /no longer the latest/,
    );
  });

  it("writes an apply_requested event, calls adapter.redeploy, and records the attempt", async () => {
    const pool = getPool();
    const { rows: userRows } = await pool.query<{ id: string }>(
      `INSERT INTO user_accounts (email, password_hash, is_staff)
       VALUES ('staff@example.com', 'x', true) RETURNING id`,
    );
    const actorId = userRows[0].id;

    const redeploy = vi.fn().mockResolvedValue({ revisionId: "rev-123" });
    vi.mocked(getPlatformAdapter).mockReturnValue({
      name: "railway",
      getCurrentImage: vi.fn(),
      redeploy,
    });
    vi.mocked(getLatestVersion).mockResolvedValue("0.5.0");

    // Seed the cache row so the UPDATE in applyUpdate has something to write to.
    await pool.query(
      `INSERT INTO update_check_cache (key, update_available) VALUES ('global', true)`,
    );

    const result = await applyUpdate("0.5.0", actorId);
    expect(result).toEqual({ revisionId: "rev-123" });
    expect(redeploy).toHaveBeenCalledWith("0.5.0");

    const { rows: evRows } = await pool.query(
      "SELECT action, actor_id, payload FROM events WHERE action = 'self_update.apply_requested'",
    );
    expect(evRows).toHaveLength(1);
    expect(evRows[0].actor_id).toBe(actorId);
    expect(evRows[0].payload).toEqual({ fromVersion: "0.4.2", toVersion: "0.5.0" });

    const { rows: cacheRows } = await pool.query(
      "SELECT last_update_attempt FROM update_check_cache WHERE key = 'global'",
    );
    expect(cacheRows[0].last_update_attempt).toMatchObject({
      version: "0.5.0",
      revisionId: "rev-123",
    });
    expect(typeof cacheRows[0].last_update_attempt.at).toBe("string");
  });
});

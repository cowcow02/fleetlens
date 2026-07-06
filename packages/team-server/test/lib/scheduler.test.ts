import { describe, it, expect, vi, afterEach } from "vitest";

describe("startScheduler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env.FLEETLENS_EXTERNAL_SCHEDULER;
  });

  it("starts without throwing", async () => {
    vi.doMock("../../src/db/pool.js", () => ({
      getPool: () => ({
        query: vi.fn().mockResolvedValue({ rowCount: 0 }),
      }),
    }));
    vi.useFakeTimers();
    const { startScheduler } = await import("../../src/lib/scheduler.js");
    expect(() => startScheduler()).not.toThrow();
    vi.useRealTimers();
  });

  it("is idempotent — calling twice does not create extra intervals", async () => {
    vi.doMock("../../src/db/pool.js", () => ({
      getPool: () => ({
        query: vi.fn().mockResolvedValue({ rowCount: 0 }),
      }),
    }));
    vi.useFakeTimers();
    const { startScheduler } = await import("../../src/lib/scheduler.js");
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    startScheduler();
    startScheduler();
    // Six setInterval calls from a single startScheduler invocation
    // (ingest-log prune + checkForUpdates + mat view refresh + github sync
    // sweep + plan_utilization prune + server_log flush); the second
    // startScheduler returns early and must not schedule more.
    expect(setIntervalSpy).toHaveBeenCalledTimes(6);
    vi.useRealTimers();
  });

  it("interval callback logs when rows are pruned", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 5 });
    vi.doMock("../../src/db/pool.js", () => ({
      getPool: () => ({ query: mockQuery }),
    }));
    vi.useFakeTimers();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { startScheduler } = await import("../../src/lib/scheduler.js");
    startScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM ingest_log")
    );
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("pruned 5"));
    vi.useRealTimers();
  });

  it("interval callback logs errors on DB failure", async () => {
    const mockQuery = vi.fn().mockRejectedValue(new Error("DB down"));
    vi.doMock("../../src/db/pool.js", () => ({
      getPool: () => ({ query: mockQuery }),
    }));
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startScheduler } = await import("../../src/lib/scheduler.js");
    startScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("prune failed"));
    vi.useRealTimers();
  });

  it("skips setInterval when FLEETLENS_EXTERNAL_SCHEDULER=1", async () => {
    process.env.FLEETLENS_EXTERNAL_SCHEDULER = "1";
    vi.doMock("../../src/db/pool.js", () => ({
      getPool: () => ({ query: vi.fn() }),
    }));
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    const { startScheduler } = await import("../../src/lib/scheduler.js");
    startScheduler();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("runs checkNow on the hourly checkForUpdates tick", async () => {
    vi.doMock("../../src/db/pool.js", () => ({
      getPool: () => ({
        query: vi.fn().mockResolvedValue({ rowCount: 0 }),
      }),
    }));
    const checkNow = vi.fn().mockResolvedValue({
      currentVersion: "0.4.2",
      latestVersion: "0.5.0",
      updateAvailable: true,
      lastCheckedAt: new Date(),
    });
    vi.doMock("../../src/lib/self-update/service.js", () => ({ checkNow }));
    vi.useFakeTimers();
    const { startScheduler } = await import("../../src/lib/scheduler.js");
    startScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(checkNow).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("kicks off an initial checkNow ~5s after boot", async () => {
    vi.doMock("../../src/db/pool.js", () => ({
      getPool: () => ({
        query: vi.fn().mockResolvedValue({ rowCount: 0 }),
      }),
    }));
    const checkNow = vi.fn().mockResolvedValue({
      currentVersion: "0.4.2",
      latestVersion: null,
      updateAvailable: false,
      lastCheckedAt: new Date(),
    });
    vi.doMock("../../src/lib/self-update/service.js", () => ({ checkNow }));
    vi.useFakeTimers();
    const { startScheduler } = await import("../../src/lib/scheduler.js");
    startScheduler();
    expect(checkNow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(checkNow).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("refreshes the mat view on the hourly tick", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 0 });
    vi.doMock("../../src/db/pool.js", () => ({ getPool: () => ({ query: mockQuery }) }));
    vi.useFakeTimers();
    const { startScheduler } = await import("../../src/lib/scheduler.js");
    startScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    const refreshCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("REFRESH MATERIALIZED VIEW CONCURRENTLY"),
    );
    expect(refreshCall).toBeDefined();
    vi.useRealTimers();
  });

  it("prunes plan_utilization on the 24h tick", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 3 });
    vi.doMock("../../src/db/pool.js", () => ({ getPool: () => ({ query: mockQuery }) }));
    vi.useFakeTimers();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { startScheduler } = await import("../../src/lib/scheduler.js");
    startScheduler();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    const pruneCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("DELETE FROM plan_utilization"),
    );
    expect(pruneCall).toBeDefined();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("pruned 3 plan_utilization rows"),
    );
    vi.useRealTimers();
  });

  it("logs and swallows errors from checkForUpdates ticks", async () => {
    vi.doMock("../../src/db/pool.js", () => ({
      getPool: () => ({
        query: vi.fn().mockResolvedValue({ rowCount: 0 }),
      }),
    }));
    const checkNow = vi.fn().mockRejectedValue(new Error("network down"));
    vi.doMock("../../src/lib/self-update/service.js", () => ({ checkNow }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    const { startScheduler } = await import("../../src/lib/scheduler.js");
    startScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("checkForUpdates failed"),
      expect.any(Error),
    );
    vi.useRealTimers();
  });
});

describe("pruneIngestLog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns the row count of deleted rows", async () => {
    vi.doMock("../../src/db/pool.js", () => ({
      getPool: () => ({
        query: vi.fn().mockResolvedValue({ rowCount: 7 }),
      }),
    }));
    const { pruneIngestLog } = await import("../../src/lib/scheduler.js");
    await expect(pruneIngestLog()).resolves.toBe(7);
  });

  it("returns 0 when rowCount is null", async () => {
    vi.doMock("../../src/db/pool.js", () => ({
      getPool: () => ({
        query: vi.fn().mockResolvedValue({ rowCount: null }),
      }),
    }));
    const { pruneIngestLog } = await import("../../src/lib/scheduler.js");
    await expect(pruneIngestLog()).resolves.toBe(0);
  });
});

describe("refreshMembershipWeeklyUtilization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("issues REFRESH MATERIALIZED VIEW CONCURRENTLY against the right view", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 0 });
    vi.doMock("../../src/db/pool.js", () => ({ getPool: () => ({ query: mockQuery }) }));
    const { refreshMembershipWeeklyUtilization } = await import(
      "../../src/lib/scheduler.js"
    );
    await refreshMembershipWeeklyUtilization();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(
        /REFRESH MATERIALIZED VIEW CONCURRENTLY membership_weekly_utilization/,
      ),
    );
  });
});

describe("prunePlanUtilization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("respects per-team retention_days via JOIN to teams", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 42 });
    vi.doMock("../../src/db/pool.js", () => ({ getPool: () => ({ query: mockQuery }) }));
    const { prunePlanUtilization } = await import("../../src/lib/scheduler.js");
    await expect(prunePlanUtilization()).resolves.toBe(42);

    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/DELETE FROM plan_utilization/);
    expect(sql).toMatch(/USING teams/);
    expect(sql).toMatch(/make_interval\(days =>\s*t\.retention_days\)/);
  });

  it("returns 0 when rowCount is null", async () => {
    vi.doMock("../../src/db/pool.js", () => ({
      getPool: () => ({ query: vi.fn().mockResolvedValue({ rowCount: null }) }),
    }));
    const { prunePlanUtilization } = await import("../../src/lib/scheduler.js");
    await expect(prunePlanUtilization()).resolves.toBe(0);
  });
});

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

describe("POST /api/admin/prune", () => {
  beforeEach(() => {
    delete process.env.FLEETLENS_SCHEDULER_SECRET;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env.FLEETLENS_SCHEDULER_SECRET;
  });

  it("returns 503 when scheduler secret is not configured", async () => {
    vi.doMock("../../src/lib/scheduler.js", () => ({
      pruneIngestLog: vi.fn(),
    }));
    const { POST } = await import("../../src/app/api/admin/prune/route.js");
    const res = await POST(
      new Request("http://localhost/api/admin/prune", {
        method: "POST",
        headers: { "x-scheduler-secret": "anything" },
      })
    );
    expect(res.status).toBe(503);
  });

  it("returns 401 when the secret header is missing", async () => {
    process.env.FLEETLENS_SCHEDULER_SECRET = "s3cret";
    vi.doMock("../../src/lib/scheduler.js", () => ({
      pruneIngestLog: vi.fn(),
    }));
    const { POST } = await import("../../src/app/api/admin/prune/route.js");
    const res = await POST(
      new Request("http://localhost/api/admin/prune", { method: "POST" })
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when the secret header is wrong", async () => {
    process.env.FLEETLENS_SCHEDULER_SECRET = "s3cret";
    vi.doMock("../../src/lib/scheduler.js", () => ({
      pruneIngestLog: vi.fn(),
    }));
    const { POST } = await import("../../src/app/api/admin/prune/route.js");
    const res = await POST(
      new Request("http://localhost/api/admin/prune", {
        method: "POST",
        headers: { "x-scheduler-secret": "wrong" },
      })
    );
    expect(res.status).toBe(401);
  });

  it("prunes and returns count when secret matches", async () => {
    process.env.FLEETLENS_SCHEDULER_SECRET = "s3cret";
    const pruneIngestLog = vi.fn().mockResolvedValue(12);
    const pruneMemberSyncLog = vi.fn().mockResolvedValue(3);
    vi.doMock("../../src/lib/scheduler.js", () => ({ pruneIngestLog, pruneMemberSyncLog }));
    const { POST } = await import("../../src/app/api/admin/prune/route.js");
    const res = await POST(
      new Request("http://localhost/api/admin/prune", {
        method: "POST",
        headers: { "x-scheduler-secret": "s3cret" },
      })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ pruned: 12, prunedSyncLog: 3 });
    expect(pruneIngestLog).toHaveBeenCalledOnce();
    expect(pruneMemberSyncLog).toHaveBeenCalledOnce();
  });
});

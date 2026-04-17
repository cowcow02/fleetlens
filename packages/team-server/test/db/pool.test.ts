import { describe, it, expect, vi, afterEach } from "vitest";

describe("getPool", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("throws when DATABASE_URL is not set", async () => {
    // Save and remove DATABASE_URL
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    // Reset the module so the singleton is cleared
    vi.resetModules();
    const { getPool } = await import("../../src/db/pool.js");

    expect(() => getPool()).toThrow("DATABASE_URL is not set");

    // Restore
    process.env.DATABASE_URL = saved;
  });

  it("returns the same pool instance on repeated calls (singleton)", async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost:5432/fleetlens_dev";
    vi.resetModules();
    const { getPool } = await import("../../src/db/pool.js");
    const p1 = getPool();
    const p2 = getPool();
    expect(p1).toBe(p2);
    await p1.end();
  });
});

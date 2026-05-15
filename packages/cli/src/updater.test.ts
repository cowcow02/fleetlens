import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  shouldUpdate,
  isDevMode,
  getUpdateAvailability,
} from "./updater.js";

describe("shouldUpdate", () => {
  it("returns true when remote is newer", () => {
    expect(shouldUpdate("0.1.0", "0.2.0")).toBe(true);
  });

  it("returns false when versions are equal", () => {
    expect(shouldUpdate("0.2.0", "0.2.0")).toBe(false);
  });

  it("returns false when local is newer", () => {
    expect(shouldUpdate("0.3.0", "0.2.0")).toBe(false);
  });

  it("handles patch versions", () => {
    expect(shouldUpdate("0.1.0", "0.1.1")).toBe(true);
    expect(shouldUpdate("0.1.1", "0.1.0")).toBe(false);
  });
});

describe("isDevMode", () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  it("is true when argv[1] points inside packages/cli/", () => {
    process.argv = ["node", "/Users/c/repo/packages/cli/dist/index.js"];
    expect(isDevMode()).toBe(true);
  });

  it("is false when argv[1] resolves through a global npm shim", () => {
    process.argv = ["node", "/usr/local/lib/node_modules/fleetlens/dist/index.js"];
    expect(isDevMode()).toBe(false);
  });
});

describe("getUpdateAvailability", () => {
  const originalArgv = process.argv;
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Force non-dev so getUpdateAvailability actually runs the fetch path.
    process.argv = ["node", "/usr/local/lib/node_modules/fleetlens/dist/index.js"];
  });

  afterEach(() => {
    process.argv = originalArgv;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns null in dev mode", async () => {
    process.argv = ["node", "/repo/packages/cli/dist/index.js"];
    expect(await getUpdateAvailability()).toBeNull();
  });

  it("returns latest=null + updateAvailable=false when the registry is unreachable", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    const result = await getUpdateAvailability();
    expect(result).toEqual({
      current: "0.0.0-test",
      latest: null,
      updateAvailable: false,
    });
  });

  it("reports updateAvailable=true when registry returns a newer version", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: "9.9.9" }), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await getUpdateAvailability();
    expect(result).toEqual({
      current: "0.0.0-test",
      latest: "9.9.9",
      updateAvailable: true,
    });
  });

  it("reports updateAvailable=false when registry returns the same or older version", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: "0.0.0-test" }), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await getUpdateAvailability();
    expect(result?.updateAvailable).toBe(false);
  });
});

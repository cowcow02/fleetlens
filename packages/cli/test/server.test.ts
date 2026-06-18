import { describe, it, expect } from "vitest";
import { isServerStale, type ServerStatus } from "../src/server.js";

// CLI_VERSION is defined as "0.0.0-test" by vitest.config.ts.
describe("isServerStale", () => {
  it("is false when a running server matches the CLI version", () => {
    const status: ServerStatus = { running: true, pid: 1, port: 3321, version: "0.0.0-test" };
    expect(isServerStale(status)).toBe(false);
  });

  it("is true when a running server reports an older version", () => {
    const status: ServerStatus = { running: true, pid: 1, port: 3321, version: "0.11.2" };
    expect(isServerStale(status)).toBe(true);
  });

  it("is true when a running server's version is unknown (legacy pid file)", () => {
    const status: ServerStatus = { running: true, pid: 1, port: 3321, version: undefined };
    expect(isServerStale(status)).toBe(true);
  });

  it("is false when no server is running", () => {
    expect(isServerStale({ running: false })).toBe(false);
  });
});

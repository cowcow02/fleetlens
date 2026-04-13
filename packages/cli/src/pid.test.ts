import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writePid, readPid, isProcessAlive, cleanStalePid } from "./pid.js";

describe("pid", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cclens-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes and reads a PID file with port", () => {
    const pidFile = join(dir, "pid");
    writePid(pidFile, 12345, 3321);
    expect(readPid(pidFile)).toEqual({ pid: 12345, port: 3321 });
  });

  it("writes and reads a PID file without port", () => {
    const pidFile = join(dir, "pid");
    writePid(pidFile, 12345);
    expect(readPid(pidFile)).toEqual({ pid: 12345, port: undefined });
  });

  it("returns null for missing PID file", () => {
    expect(readPid(join(dir, "nope"))).toBeNull();
  });

  it("detects current process as alive", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("detects non-existent PID as dead", () => {
    expect(isProcessAlive(999999)).toBe(false);
  });

  it("cleans stale PID file when process is dead", () => {
    const pidFile = join(dir, "pid");
    writePid(pidFile, 999999, 3321);
    const result = cleanStalePid(pidFile);
    expect(result).toBe(true);
    expect(readPid(pidFile)).toBeNull();
  });

  it("does not clean PID file when process is alive", () => {
    const pidFile = join(dir, "pid");
    writePid(pidFile, process.pid, 3321);
    const result = cleanStalePid(pidFile);
    expect(result).toBe(false);
    expect(readPid(pidFile)).toEqual({ pid: process.pid, port: 3321 });
  });
});

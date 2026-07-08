import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { writePid, readPid, isProcessAlive, cleanStalePid } from "../src/pid.js";

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

  it("writes and reads a PID file with port and version", () => {
    const pidFile = join(dir, "pid");
    writePid(pidFile, 12345, 3321, "0.12.2");
    expect(readPid(pidFile)).toEqual({ pid: 12345, port: 3321, version: "0.12.2" });
  });

  it("drops version when no port is given (colon positions must stay stable)", () => {
    const pidFile = join(dir, "pid");
    writePid(pidFile, 12345, undefined, "0.12.2");
    expect(readPid(pidFile)).toEqual({ pid: 12345, port: undefined, version: undefined });
  });

  it("reads a legacy pid:port file with no version (back-compat)", () => {
    const pidFile = join(dir, "pid");
    writePid(pidFile, 12345, 3321);
    expect(readPid(pidFile)!.version).toBeUndefined();
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

describe("isProcessAlive with identity markers", () => {
  it("accepts a live pid when no markers are given", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("rejects a live pid whose command matches no marker (reused-PID trap)", () => {
    expect(isProcessAlive(process.pid, ["definitely-not-in-any-cmdline-x9z"])).toBe(false);
  });

  it("accepts a live pid whose command contains a marker", () => {
    const cmd = execFileSync("ps", ["-p", String(process.pid), "-o", "command="], { encoding: "utf8" }).trim();
    const marker = cmd.slice(0, 8);
    expect(isProcessAlive(process.pid, [marker])).toBe(true);
  });

  it("rejects a dead pid regardless of markers", () => {
    expect(isProcessAlive(99999999, ["node"])).toBe(false);
  });
});

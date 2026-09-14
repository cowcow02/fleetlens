import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnedPid } from "../src/pid.js";
import { healCliLaunchFile } from "../src/commands/menubar.js";

describe("spawnedPid", () => {
  it("returns the pid of a launched child", () => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    expect(spawnedPid(child, process.execPath)).toBeGreaterThan(0);
  });

  // With no 'error' listener the async ENOENT became an uncaughtException that
  // killed the daemon (2026-09-14). Vitest fails the run on unhandled errors,
  // so waiting past the event is the regression check.
  it("throws for a missing binary without an unhandled 'error' event", async () => {
    const missing = "/nonexistent/fleetlens-test/bin/node";
    const child = spawn(missing, [], { stdio: "ignore" });
    expect(() => spawnedPid(child, missing)).toThrow(`could not launch ${missing}`);
    await new Promise((r) => setTimeout(r, 50));
  });
});

describe("healCliLaunchFile", () => {
  let dir: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cclens-cli-launch-"));
    prevHome = process.env.CCLENS_HOME;
    process.env.CCLENS_HOME = dir;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CCLENS_HOME;
    else process.env.CCLENS_HOME = prevHome;
    rmSync(dir, { recursive: true, force: true });
  });

  it("repoints a removed Node and keeps the script path", () => {
    const file = join(dir, "cli-launch.json");
    writeFileSync(file, JSON.stringify({ node: "/gone/v22.17.0/bin/node", script: "/opt/fleetlens/dist/index.js" }));
    expect(healCliLaunchFile(process.execPath)).toEqual({ from: "/gone/v22.17.0/bin/node", to: process.execPath });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      node: process.execPath,
      script: "/opt/fleetlens/dist/index.js",
    });
  });

  it("leaves a live Node alone", () => {
    writeFileSync(join(dir, "cli-launch.json"), JSON.stringify({ node: process.execPath, script: "x" }));
    expect(healCliLaunchFile(process.execPath)).toBeNull();
  });

  it("does nothing without a launch file or a live replacement", () => {
    expect(healCliLaunchFile(process.execPath)).toBeNull();
    writeFileSync(join(dir, "cli-launch.json"), JSON.stringify({ node: "/gone/bin/node", script: "x" }));
    expect(healCliLaunchFile("/also/gone/bin/node")).toBeNull();
  });
});

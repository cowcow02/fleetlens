import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPlist, isPromptDismissed, dismissPrompt } from "../src/commands/autostart.js";

describe("buildPlist", () => {
  const plist = buildPlist({
    nodePath: "/usr/local/bin/node",
    scriptPath: "/opt/fleetlens/dist/index.js",
    logPath: "/home/me/.cclens/daemon-autostart.log",
  });

  it("declares the fleetlens daemon label", () => {
    expect(plist).toContain("<string>com.fleetlens.daemon</string>");
  });

  it("runs `<node> <script> daemon start` with absolute paths", () => {
    expect(plist).toContain("<string>/usr/local/bin/node</string>");
    expect(plist).toContain("<string>/opt/fleetlens/dist/index.js</string>");
    expect(plist).toContain("<string>daemon</string>");
    expect(plist).toContain("<string>start</string>");
  });

  it("runs at load", () => {
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
  });

  // The daemon self-updates (npm i -g + re-exec); a KeepAlive supervisor would
  // fight that teardown and thrash. Run-once-at-login is intentional.
  it("does NOT set KeepAlive", () => {
    expect(plist).not.toContain("KeepAlive");
  });

  it("routes stdout + stderr to the autostart log", () => {
    expect(plist).toContain("<key>StandardOutPath</key>");
    expect(plist).toContain("<key>StandardErrorPath</key>");
    expect(plist).toContain("<string>/home/me/.cclens/daemon-autostart.log</string>");
  });

  it("is well-formed plist XML", () => {
    expect(plist).toMatch(/^<\?xml/);
    expect(plist).toContain("<!DOCTYPE plist");
    expect(plist).toContain("</plist>");
  });
});

describe("autostart prompt dismissal flag", () => {
  let dir: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cclens-autostart-"));
    prevHome = process.env.CCLENS_HOME;
    process.env.CCLENS_HOME = dir;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CCLENS_HOME;
    else process.env.CCLENS_HOME = prevHome;
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to not dismissed", () => {
    expect(isPromptDismissed()).toBe(false);
  });

  it("persists the dismissal and reports it on the next read", () => {
    dismissPrompt();
    expect(existsSync(join(dir, "autostart.json"))).toBe(true);
    expect(isPromptDismissed()).toBe(true);
  });
});

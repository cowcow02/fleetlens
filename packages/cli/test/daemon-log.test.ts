import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendDaemonLogLine } from "../src/daemon-log.js";

let home: string;
let prev: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cclens-daemonlog-"));
  prev = process.env.CCLENS_HOME;
  process.env.CCLENS_HOME = home;
});

afterEach(() => {
  if (prev === undefined) delete process.env.CCLENS_HOME;
  else process.env.CCLENS_HOME = prev;
  rmSync(home, { recursive: true, force: true });
});

describe("appendDaemonLogLine", () => {
  it("appends `${ISO} ${LEVEL} ${msg}` to daemon.log so sync-log can pick it up", () => {
    // This is the shared writer manual `team sync` uses so its [sync] line
    // reaches daemon.log (finding 6 — manual runs used to log to console only).
    appendDaemonLogLine("info", "[sync] ok · manual · pushed 1 day (2026-07-07)");
    const raw = readFileSync(join(home, "daemon.log"), "utf8");
    expect(raw).toMatch(
      /^\S+ INFO \[sync\] ok · manual · pushed 1 day \(2026-07-07\)\n$/,
    );
    // The leading token is a parseable ISO timestamp (readPendingSyncLog regex).
    const ts = raw.split(" ")[0];
    expect(Number.isNaN(Date.parse(ts))).toBe(false);
  });

  it("appends (not truncates) across calls and uppercases the level", () => {
    appendDaemonLogLine("info", "first");
    appendDaemonLogLine("warn", "second");
    const lines = readFileSync(join(home, "daemon.log"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].includes("INFO first")).toBe(true);
    expect(lines[1].includes("WARN second")).toBe(true);
  });

  it("never throws when the log dir is unwritable (swallows the error)", () => {
    // Point CCLENS_HOME at a path whose parent is a file → mkdir/append fails.
    process.env.CCLENS_HOME = join(home, "daemon.log-not-a-dir", "nested");
    // A real file where a dir is expected would make append throw; the helper
    // must swallow it rather than crash the daemon / pairing / manual sync.
    expect(() => appendDaemonLogLine("error", "boom")).not.toThrow();
    expect(existsSync(join(home, "daemon.log"))).toBe(false);
  });
});

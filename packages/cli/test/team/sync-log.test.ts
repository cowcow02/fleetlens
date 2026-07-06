import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readPendingSyncLog } from "../../src/team/sync-log.js";

let home: string;
let prev: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cclens-synclog-"));
  prev = process.env.CCLENS_HOME;
  process.env.CCLENS_HOME = home;
});

afterEach(() => {
  if (prev === undefined) delete process.env.CCLENS_HOME;
  else process.env.CCLENS_HOME = prev;
  rmSync(home, { recursive: true, force: true });
});

function writeLog(lines: string[]) {
  writeFileSync(join(home, "daemon.log"), lines.join("\n"));
}

describe("readPendingSyncLog", () => {
  it("keeps only the [sync] summary lines, dropping every other line", () => {
    writeLog([
      "2026-07-01T10:00:00.000Z INFO [sync] ok · auto · pushed 1 day (2026-07-01) · 1.2s · next ~5m",
      "2026-07-01T10:00:01.000Z INFO codex snapshot saved",
      "2026-07-01T10:00:02.000Z INFO team backfill: 1 new, 0 already-known across 1 batch",
      "2026-07-01T10:00:03.000Z WARN [sync] failed · auto · live-snapshot push HTTP 503 — queued for retry · 0.9s",
      "some malformed line without a level",
    ]);
    const { lines } = readPendingSyncLog();
    expect(lines.map((l) => l.msg)).toEqual([
      "[sync] ok · auto · pushed 1 day (2026-07-01) · 1.2s · next ~5m",
      "[sync] failed · auto · live-snapshot push HTTP 503 — queued for retry · 0.9s",
    ]);
  });

  it("respects the watermark (excludes ts <= watermark)", () => {
    writeLog([
      "2026-07-01T10:00:00.000Z INFO [sync] ok · auto · a",
      "2026-07-01T10:00:05.000Z INFO [sync] ok · auto · b",
      "2026-07-01T10:00:10.000Z INFO [sync] ok · auto · c",
    ]);
    const { lines } = readPendingSyncLog("2026-07-01T10:00:05.000Z");
    expect(lines.map((l) => l.msg)).toEqual(["[sync] ok · auto · c"]);
  });

  it("lowercases the level", () => {
    writeLog(["2026-07-01T10:00:00.000Z WARN [sync] degraded · auto · retry"]);
    const { lines } = readPendingSyncLog();
    expect(lines[0].level).toBe("warn");
  });

  it("returns the newest line's ts as the watermark", () => {
    writeLog([
      "2026-07-01T10:00:00.000Z INFO [sync] ok · auto · a",
      "2026-07-01T10:00:10.000Z ERROR [sync] error · auto · b",
    ]);
    const { watermark } = readPendingSyncLog();
    expect(watermark).toBe("2026-07-01T10:00:10.000Z");
  });

  it("returns {lines: []} when daemon.log is missing (no throw)", () => {
    expect(readPendingSyncLog()).toEqual({ lines: [] });
  });

  it("caps at the last 300 lines", () => {
    const lines: string[] = [];
    for (let i = 0; i < 350; i++) {
      const ts = new Date(Date.UTC(2026, 6, 1, 0, 0, i)).toISOString();
      lines.push(`${ts} INFO [sync] ok · auto · #${i}`);
    }
    writeLog(lines);
    const res = readPendingSyncLog();
    expect(res.lines).toHaveLength(300);
    expect(res.lines[0].msg).toBe("[sync] ok · auto · #50");
    expect(res.lines[299].msg).toBe("[sync] ok · auto · #349");
    expect(res.watermark).toBe(new Date(Date.UTC(2026, 6, 1, 0, 0, 349)).toISOString());
  });
});

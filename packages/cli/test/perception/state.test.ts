import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readState, updateCheckpoint, markSweepStart, markSweepEnd,
  isSweepStale, __setStatePathForTest,
} from "../../src/perception/state.js";

describe("perception state", () => {
  let tmp: string;
  let statePath: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "perc-state-"));
    statePath = join(tmp, "perception-state.json");
    __setStatePathForTest(statePath);
  });

  it("readState returns empty default when file absent", () => {
    const s = readState();
    expect(s.sweep_in_progress).toBe(false);
    expect(s.file_checkpoints).toEqual({});
  });

  it("markSweepStart / markSweepEnd update in-progress flag", () => {
    markSweepStart();
    expect(readState().sweep_in_progress).toBe(true);
    expect(readState().last_sweep_started_at).toBeTruthy();
    markSweepEnd();
    expect(readState().sweep_in_progress).toBe(false);
    expect(readState().last_sweep_completed_at).toBeTruthy();
  });

  it("updateCheckpoint persists per-file state", () => {
    updateCheckpoint("/path/foo.jsonl", {
      byte_offset: 1024,
      last_event_ts: "2026-04-22T00:00:00Z",
      affects_days: ["2026-04-22"],
    });
    const s = readState();
    expect(s.file_checkpoints["/path/foo.jsonl"]!.byte_offset).toBe(1024);
    expect(s.file_checkpoints["/path/foo.jsonl"]!.affects_days).toEqual(["2026-04-22"]);
  });

  it("isSweepStale returns false for fresh in-progress flag", () => {
    markSweepStart();
    expect(isSweepStale()).toBe(false);
  });

  it("isSweepStale returns true after 15 min", () => {
    // Write stale state directly
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    writeFileSync(statePath, JSON.stringify({
      sweep_in_progress: true,
      last_sweep_started_at: stale,
      last_sweep_completed_at: null,
      file_checkpoints: {},
    }));
    expect(isSweepStale()).toBe(true);
  });

  it("atomic write pattern — no tmp file leftover after updateCheckpoint", () => {
    updateCheckpoint("/path/foo.jsonl", { byte_offset: 100, last_event_ts: null, affects_days: [] });
    const files = readdirSync(tmp);
    expect(files.some((f: string) => f.endsWith(".tmp"))).toBe(false);
  });
});

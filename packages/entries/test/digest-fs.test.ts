import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeDayDigest, readDayDigest, getTodayDigestFromCache, setTodayDigestInCache,
  __setDigestsDirForTest, __clearTodayCacheForTest,
} from "../src/digest-fs.js";
import type { DayDigest } from "../src/types.js";

function mkDigest(date: string): DayDigest {
  return {
    version: 2, scope: "day", key: date,
    window: { start: `${date}T00:00:00`, end: `${date}T23:59:59` },
    entry_refs: [], generated_at: new Date().toISOString(), is_live: false,
    model: null, cost_usd: null, projects: [], shipped: [], top_flags: [],
    top_goal_categories: [], concurrency_peak: 0, agent_min: 0,
    headline: "h", narrative: null, what_went_well: null, what_hit_friction: null, suggestion: null,
  };
}

describe("digest-fs", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "digests-"));
    __setDigestsDirForTest(tmp);
    __clearTodayCacheForTest();
  });

  it("write + read round-trip", () => {
    const d = mkDigest("2026-04-23");
    writeDayDigest(d);
    const back = readDayDigest("2026-04-23");
    expect(back).toEqual(d);
  });

  it("readDayDigest returns null for missing file", () => {
    expect(readDayDigest("2026-01-01")).toBeNull();
  });

  it("atomic write via rename (temp file removed)", () => {
    const d = mkDigest("2026-04-23");
    writeDayDigest(d);
    const final = join(tmp, "day", "2026-04-23.json");
    expect(existsSync(final)).toBe(true);
    expect(existsSync(`${final}.tmp`)).toBe(false);
    const raw = readFileSync(final, "utf8");
    expect(JSON.parse(raw)).toEqual(d);
  });

  it("today cache round-trip + TTL invalidation", () => {
    const d = mkDigest("2026-04-24");
    setTodayDigestInCache("2026-04-24", d, Date.now());
    expect(getTodayDigestFromCache("2026-04-24", Date.now())).toEqual(d);
    expect(getTodayDigestFromCache("2026-04-24", Date.now() + 11 * 60 * 1000)).toBeNull();
  });

  it("today cache key mismatch returns null", () => {
    const d = mkDigest("2026-04-24");
    setTodayDigestInCache("2026-04-24", d, Date.now());
    expect(getTodayDigestFromCache("2026-04-25", Date.now())).toBeNull();
  });

  // A stale/corrupt digest file must be ignored (return null), not crash the
  // consumers that dereference d.shipped.length on the home/day/index routes.
  it("readDayDigest returns null for a file missing the shipped array", () => {
    const bad = { version: 2, scope: "day", key: "2026-05-01", headline: "x" };
    writeFileSync(join(tmp, "day", "2026-05-01.json"), JSON.stringify(bad), "utf8");
    expect(readDayDigest("2026-05-01")).toBeNull();
  });

  it("readDayDigest returns null for an incompatible schema version", () => {
    const stale = { ...mkDigest("2026-05-02"), version: 1 };
    writeFileSync(join(tmp, "day", "2026-05-02.json"), JSON.stringify(stale), "utf8");
    expect(readDayDigest("2026-05-02")).toBeNull();
  });

  it("readDayDigest returns null for malformed JSON", () => {
    writeFileSync(join(tmp, "day", "2026-05-03.json"), "{ not valid json", "utf8");
    expect(readDayDigest("2026-05-03")).toBeNull();
  });
});

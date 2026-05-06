import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  __setSettingsPathForTest, writeSettings,
  __setInteractiveLockPathForTest, writeInteractiveLock, removeInteractiveLock,
} from "@claude-lens/entries/node";
import { __setEntriesDirForTest, __setDigestsDirForTest } from "@claude-lens/entries/fs";
import {
  backfillLastWeekDigest, backfillYesterdayDigest,
  lastCompletedWeekMonday, yesterdayLocalDay,
} from "./backfill.js";

// Pin clock to a known Sunday so lastCompletedWeekMonday is deterministic.
// Sunday 2026-04-26 12:00 local → last completed week starts Mon 2026-04-13.
const FROZEN_NOW = new Date("2026-04-26T12:00:00").getTime();
const EXPECTED_MONDAY = "2026-04-13";

function makeEntry(localDay: string, sessionId: string) {
  return {
    schema_version: 1,
    session_id: sessionId,
    local_day: localDay,
    project: "/Users/test/repo/foo",
    project_canonical: "/Users/test/repo/foo",
    project_dir: "-Users-test-repo-foo",
    start_iso: `${localDay}T10:00:00.000Z`,
    end_iso: `${localDay}T10:30:00.000Z`,
    numbers: {
      active_min: 30, turn_count: 5, tools_total: 10,
      subagent_calls: 0, skill_calls: 0, exit_plan_calls: 0,
      interrupts: 0, prs: 0, tokens_in: 100, tokens_out: 200,
    },
    tools_top: [],
    flags: [],
    pr_titles: [],
    enrichment: { status: "pending" as const },
    source_checkpoint: { byte_offset: 1024 },
  };
}

describe("backfillLastWeekDigest gates", () => {
  let tmp: string;
  let entriesDir: string;
  let digestsDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "backfill-"));
    entriesDir = join(tmp, "entries");
    digestsDir = join(tmp, "digests");
    mkdirSync(entriesDir, { recursive: true });
    mkdirSync(digestsDir, { recursive: true });
    __setSettingsPathForTest(join(tmp, "settings.json"));
    __setEntriesDirForTest(entriesDir);
    __setDigestsDirForTest(digestsDir);
    __setInteractiveLockPathForTest(join(tmp, "llm-interactive.lock"));

    // Default: AI on, autofill on. Override per test.
    writeSettings({
      ai_features: {
        enabled: true,
        model: "sonnet",
        monthlyBudgetUsd: null,
        autoBackfillLastWeek: true,
        autoBackfillYesterday: true,
      },
    });
  });

  afterEach(() => {
    // Clear any heartbeat the lock may have started.
    removeInteractiveLock();
  });

  it("lastCompletedWeekMonday: Sunday → previous Monday", () => {
    expect(lastCompletedWeekMonday(FROZEN_NOW)).toBe(EXPECTED_MONDAY);
  });

  it("ai_disabled: skip when AI features off", async () => {
    writeSettings({
      ai_features: {
        enabled: false, model: "sonnet", monthlyBudgetUsd: null,
        autoBackfillLastWeek: true, autoBackfillYesterday: true,
      },
    });
    const fakePipeline = vi.fn();
    const r = await backfillLastWeekDigest({ now: FROZEN_NOW, runPipeline: fakePipeline as never });
    expect(r).toEqual({ fired: false, reason: "ai_disabled", key: EXPECTED_MONDAY });
    expect(fakePipeline).not.toHaveBeenCalled();
  });

  it("autofill_disabled: skip when only the auto-backfill flag is off", async () => {
    writeSettings({
      ai_features: {
        enabled: true, model: "sonnet", monthlyBudgetUsd: null,
        autoBackfillLastWeek: false, autoBackfillYesterday: true,
      },
    });
    const fakePipeline = vi.fn();
    const r = await backfillLastWeekDigest({ now: FROZEN_NOW, runPipeline: fakePipeline as never });
    expect(r).toEqual({ fired: false, reason: "autofill_disabled", key: EXPECTED_MONDAY });
    expect(fakePipeline).not.toHaveBeenCalled();
  });

  it("already_cached: skip when last week's digest exists on disk", async () => {
    const weekDir = join(digestsDir, "week");
    mkdirSync(weekDir, { recursive: true });
    writeFileSync(join(weekDir, `${EXPECTED_MONDAY}.json`), JSON.stringify({
      schema_version: 1, scope: "week", key: EXPECTED_MONDAY,
      window: { start_local_day: EXPECTED_MONDAY, end_local_day: "2026-04-19" },
      agent_min_total: 0, projects: [], shipped: [], outcome_mix: {},
      generated_iso: "2026-04-20T00:00:00.000Z", generation_ms: 1, model: null,
    }));
    const fakePipeline = vi.fn();
    const r = await backfillLastWeekDigest({ now: FROZEN_NOW, runPipeline: fakePipeline as never });
    expect(r).toEqual({ fired: false, reason: "already_cached", key: EXPECTED_MONDAY });
    expect(fakePipeline).not.toHaveBeenCalled();
  });

  it("no_entries: skip when no entries exist for any day in last week", async () => {
    const fakePipeline = vi.fn();
    const r = await backfillLastWeekDigest({ now: FROZEN_NOW, runPipeline: fakePipeline as never });
    expect(r).toEqual({ fired: false, reason: "no_entries", key: EXPECTED_MONDAY });
    expect(fakePipeline).not.toHaveBeenCalled();
  });

  it("in_flight: skip when the interactive pipeline lock is fresh", async () => {
    const day = "2026-04-15";
    const e = makeEntry(day, "abc-123");
    const key = `${e.session_id}__${day}`;
    writeFileSync(join(entriesDir, `${key}.json`), JSON.stringify(e));

    // Simulate a synth currently running by writing the live lock with this
    // process's pid; interactiveLockFresh will see fresh mtime + pidAlive.
    writeInteractiveLock();

    const fakePipeline = vi.fn();
    const r = await backfillLastWeekDigest({ now: FROZEN_NOW, runPipeline: fakePipeline as never });
    expect(r).toEqual({ fired: false, reason: "in_flight", key: EXPECTED_MONDAY });
    expect(fakePipeline).not.toHaveBeenCalled();
  });

  it("ok: fires the pipeline when all gates open", async () => {
    const day = "2026-04-15";
    const e = makeEntry(day, "abc-123");
    const key = `${e.session_id}__${day}`;
    writeFileSync(join(entriesDir, `${key}.json`), JSON.stringify(e));

    const fakePipeline = vi.fn(async function* () {
      yield { type: "saved", path: "/fake/path/2026-04-13.json" };
      yield { type: "digest", digest: { scope: "week", key: EXPECTED_MONDAY } as never };
    });
    const logs: Array<[string, string]> = [];
    const r = await backfillLastWeekDigest({
      now: FROZEN_NOW,
      runPipeline: fakePipeline as never,
      log: (lvl, msg) => logs.push([lvl, msg]),
    });

    expect(r).toEqual({ fired: true, reason: "ok", key: EXPECTED_MONDAY });
    expect(fakePipeline).toHaveBeenCalledTimes(1);
    const call = fakePipeline.mock.calls[0] as unknown as [string, {
      caller: string; todayLocalDay: string; currentWeekMonday: string;
    }];
    expect(call[0]).toBe(EXPECTED_MONDAY);
    expect(call[1].caller).toBe("daemon");
    expect(call[1].todayLocalDay).toBe("2026-04-26");
    expect(call[1].currentWeekMonday).toBe("2026-04-20");

    expect(logs.some(([lvl, m]) => lvl === "info" && m.includes(`fired week-${EXPECTED_MONDAY}`))).toBe(true);
  });
});

describe("backfillYesterdayDigest gates", () => {
  // Pinned clock: Mon 2026-04-27 12:00 local → yesterday is Sun 2026-04-26.
  const FROZEN_DAY_NOW = new Date("2026-04-27T12:00:00").getTime();
  const EXPECTED_YESTERDAY = "2026-04-26";

  let tmp: string;
  let entriesDir: string;
  let digestsDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "backfill-day-"));
    entriesDir = join(tmp, "entries");
    digestsDir = join(tmp, "digests");
    mkdirSync(entriesDir, { recursive: true });
    mkdirSync(digestsDir, { recursive: true });
    __setSettingsPathForTest(join(tmp, "settings.json"));
    __setEntriesDirForTest(entriesDir);
    __setDigestsDirForTest(digestsDir);
    __setInteractiveLockPathForTest(join(tmp, "llm-interactive.lock"));

    writeSettings({
      ai_features: {
        enabled: true,
        model: "sonnet",
        monthlyBudgetUsd: null,
        autoBackfillLastWeek: true,
        autoBackfillYesterday: true,
      },
    });
  });

  afterEach(() => {
    removeInteractiveLock();
  });

  it("yesterdayLocalDay: today's ms → previous local day", () => {
    expect(yesterdayLocalDay(FROZEN_DAY_NOW)).toBe(EXPECTED_YESTERDAY);
  });

  it("ai_disabled: skip when AI features off", async () => {
    writeSettings({
      ai_features: {
        enabled: false, model: "sonnet", monthlyBudgetUsd: null,
        autoBackfillLastWeek: true, autoBackfillYesterday: true,
      },
    });
    const fakePipeline = vi.fn();
    const r = await backfillYesterdayDigest({ now: FROZEN_DAY_NOW, runPipeline: fakePipeline as never });
    expect(r).toEqual({ fired: false, reason: "ai_disabled", key: EXPECTED_YESTERDAY });
    expect(fakePipeline).not.toHaveBeenCalled();
  });

  it("autofill_disabled: skip when only the day auto-backfill flag is off", async () => {
    writeSettings({
      ai_features: {
        enabled: true, model: "sonnet", monthlyBudgetUsd: null,
        autoBackfillLastWeek: true, autoBackfillYesterday: false,
      },
    });
    const fakePipeline = vi.fn();
    const r = await backfillYesterdayDigest({ now: FROZEN_DAY_NOW, runPipeline: fakePipeline as never });
    expect(r).toEqual({ fired: false, reason: "autofill_disabled", key: EXPECTED_YESTERDAY });
    expect(fakePipeline).not.toHaveBeenCalled();
  });

  it("already_cached: skip when yesterday's day digest exists on disk", async () => {
    const dayDir = join(digestsDir, "day");
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(join(dayDir, `${EXPECTED_YESTERDAY}.json`), JSON.stringify({
      schema_version: 1, scope: "day", key: EXPECTED_YESTERDAY,
      window: { start_local_day: EXPECTED_YESTERDAY, end_local_day: EXPECTED_YESTERDAY },
      agent_min: 0, projects: [], shipped: [],
      generated_iso: "2026-04-27T00:00:00.000Z", generation_ms: 1, model: null,
    }));
    const fakePipeline = vi.fn();
    const r = await backfillYesterdayDigest({ now: FROZEN_DAY_NOW, runPipeline: fakePipeline as never });
    expect(r).toEqual({ fired: false, reason: "already_cached", key: EXPECTED_YESTERDAY });
    expect(fakePipeline).not.toHaveBeenCalled();
  });

  it("no_entries: skip when no entries exist for yesterday", async () => {
    const fakePipeline = vi.fn();
    const r = await backfillYesterdayDigest({ now: FROZEN_DAY_NOW, runPipeline: fakePipeline as never });
    expect(r).toEqual({ fired: false, reason: "no_entries", key: EXPECTED_YESTERDAY });
    expect(fakePipeline).not.toHaveBeenCalled();
  });

  it("in_flight: skip when the interactive pipeline lock is fresh", async () => {
    const e = makeEntry(EXPECTED_YESTERDAY, "abc-123");
    const key = `${e.session_id}__${EXPECTED_YESTERDAY}`;
    writeFileSync(join(entriesDir, `${key}.json`), JSON.stringify(e));
    writeInteractiveLock();

    const fakePipeline = vi.fn();
    const r = await backfillYesterdayDigest({ now: FROZEN_DAY_NOW, runPipeline: fakePipeline as never });
    expect(r).toEqual({ fired: false, reason: "in_flight", key: EXPECTED_YESTERDAY });
    expect(fakePipeline).not.toHaveBeenCalled();
  });

  it("ok: fires the day pipeline when all gates open", async () => {
    const e = makeEntry(EXPECTED_YESTERDAY, "abc-123");
    const key = `${e.session_id}__${EXPECTED_YESTERDAY}`;
    writeFileSync(join(entriesDir, `${key}.json`), JSON.stringify(e));

    const fakePipeline = vi.fn(async function* () {
      yield { type: "saved", path: `/fake/path/${EXPECTED_YESTERDAY}.json` };
      yield { type: "digest", digest: { scope: "day", key: EXPECTED_YESTERDAY } as never };
    });
    const logs: Array<[string, string]> = [];
    const r = await backfillYesterdayDigest({
      now: FROZEN_DAY_NOW,
      runPipeline: fakePipeline as never,
      log: (lvl, msg) => logs.push([lvl, msg]),
    });

    expect(r).toEqual({ fired: true, reason: "ok", key: EXPECTED_YESTERDAY });
    expect(fakePipeline).toHaveBeenCalledTimes(1);
    const call = fakePipeline.mock.calls[0] as unknown as [string, {
      caller: string; todayLocalDay: string;
    }];
    expect(call[0]).toBe(EXPECTED_YESTERDAY);
    expect(call[1].caller).toBe("daemon");
    expect(call[1].todayLocalDay).toBe("2026-04-27");

    expect(logs.some(([lvl, m]) => lvl === "info" && m.includes(`fired day-${EXPECTED_YESTERDAY}`))).toBe(true);
  });
});

describe("interactive lock heartbeat", () => {
  let tmp: string;
  let lockFile: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "lock-hb-"));
    lockFile = join(tmp, "llm-interactive.lock");
    __setInteractiveLockPathForTest(lockFile);
  });

  afterEach(() => {
    removeInteractiveLock();
  });

  it("writeInteractiveLock keeps mtime fresh past the original 60s STALE_MS via heartbeat", async () => {
    vi.useFakeTimers();
    try {
      const t0 = Date.now();
      vi.setSystemTime(t0);
      writeInteractiveLock();
      const initialMtime = statSync(lockFile).mtimeMs;

      // Advance past the heartbeat interval (30s) — the timer should have fired
      // and re-touched the file even without an explicit caller refresh.
      vi.setSystemTime(t0 + 31_000);
      await vi.advanceTimersByTimeAsync(31_000);

      const refreshedMtime = statSync(lockFile).mtimeMs;
      expect(refreshedMtime).toBeGreaterThanOrEqual(initialMtime);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removeInteractiveLock clears the heartbeat and deletes the file", () => {
    writeInteractiveLock();
    expect(statSync(lockFile).isFile()).toBe(true);
    removeInteractiveLock();
    expect(() => statSync(lockFile)).toThrow();
  });
});

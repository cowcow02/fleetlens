import { describe, it, expect } from "vitest";
import { buildSyncLine, type SyncSummary } from "../../src/team/sync.js";

const empty = (): SyncSummary => ({
  pushedDays: [],
  droppedDays: [],
  queued: 0,
  queuedDrained: 0,
  usageSnapshots: 0,
});

describe("buildSyncLine", () => {
  it("leads with a fixed `[sync] <status>` token an agent can regex", () => {
    const line = buildSyncLine("ok", "auto", empty(), 1200, 5 * 60_000);
    expect(line.startsWith("[sync] ok · auto")).toBe(true);
    expect(line).toMatch(/^\[sync\] (ok|idle|degraded|failed|error) /);
  });

  it("renders a clean multi-day push with the server's accepted verdict", () => {
    const s = empty();
    s.pushedDays = ["2026-07-04", "2026-07-05"];
    s.usageSnapshots = 1;
    s.accepted = ["dailyRollup", "richRollup", "planTier", "syncLog"];
    const line = buildSyncLine("ok", "auto", s, 1420, 5 * 60_000);
    expect(line).toBe(
      "[sync] ok · auto · pushed 2 days (2026-07-04→2026-07-05) · usage +1 snapshot · " +
        "server accepted dailyRollup,richRollup,planTier,syncLog · 1.4s · next ~5m",
    );
  });

  it("keeps BOTH outcomes on a mixed run (pushed one, queued another)", () => {
    const s = empty();
    s.pushedDays = ["2026-07-04"];
    s.queued = 1;
    s.queuedDay = "2026-07-05";
    s.queuedStatus = 503;
    const line = buildSyncLine("failed", "auto", s, 2100, 5 * 60_000);
    expect(line).toContain("pushed 1 day (2026-07-04)");
    expect(line).toContain("queued 1 for retry (2026-07-05, HTTP 503)");
    expect(line.startsWith("[sync] failed")).toBe(true);
  });

  it("surfaces a server-skipped block as its own attribute", () => {
    const s = empty();
    s.pushedDays = ["2026-07-05"];
    s.skipped = { richRollup: "2/5 rows failed schema" };
    const line = buildSyncLine("degraded", "auto", s, 1100, 5 * 60_000);
    expect(line).toContain("server SKIPPED richRollup (2/5 rows failed schema)");
  });

  it("renders an idle live-only tick with the current utilization", () => {
    const s = empty();
    s.idleReason = "no new daily activity";
    s.live = "5h 25% / 7d 86%";
    const line = buildSyncLine("idle", "auto", s, 400, 5 * 60_000);
    expect(line).toBe(
      "[sync] idle · auto · no new daily activity · live 5h 25% / 7d 86% · 400ms · next ~5m",
    );
  });

  it("tags a first-boot run with trigger=boot", () => {
    const line = buildSyncLine("idle", "boot", { ...empty(), idleReason: "nothing to sync" }, 90, 5 * 60_000);
    expect(line).toBe("[sync] idle · boot · nothing to sync · 90ms · next ~5m");
  });

  it("tags the first-pair backfill with trigger=pair and its full day range", () => {
    const s = empty();
    s.pushedDays = Array.from({ length: 51 }, (_, i) =>
      new Date(Date.UTC(2026, 4, 18 + i)).toISOString().slice(0, 10),
    );
    s.usageSnapshots = 3;
    const line = buildSyncLine("ok", "pair", s, 6100, undefined);
    expect(line).toContain("[sync] ok · pair");
    expect(line).toContain("pushed 51 days (2026-05-18→2026-07-07)");
    expect(line).not.toContain("next ~"); // no daemon cadence promise at pair time
  });

  it("carries the error detail on an aborted run", () => {
    const s = empty();
    s.errorMsg = "sync aborted: ECONNREFUSED";
    const line = buildSyncLine("error", "auto", s, 300, undefined);
    expect(line).toBe("[sync] error · auto · sync aborted: ECONNREFUSED · 300ms");
  });
});

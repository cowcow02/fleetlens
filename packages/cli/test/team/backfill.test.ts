import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chunk, runTeamBackfill } from "../../src/team/backfill.js";

vi.mock("../../src/usage/profile.js", () => ({
  getPlanTier: vi.fn(async () => null),
}));

describe("chunk", () => {
  it("returns one chunk for an empty array", () => {
    expect(chunk([], 10)).toEqual([]);
  });

  it("respects size boundary", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns single chunk when size >= length", () => {
    expect(chunk([1, 2], 100)).toEqual([[1, 2]]);
  });
});

describe("runTeamBackfill", () => {
  let dir: string;
  const fakeConfig = {
    serverUrl: "http://localhost:9999",
    memberId: "test-member",
    bearerToken: "test-token",
    teamSlug: "test",
    pairedAt: "2026-04-29T00:00:00.000Z",
  };

  const snapshotLine = (capturedAt: string, utilization = 20) => JSON.stringify({
    captured_at: capturedAt,
    five_hour: { utilization, resets_at: "2026-04-29T07:10:00+00:00" },
    seven_day: { utilization, resets_at: "2026-05-04T12:00:00+00:00" },
    seven_day_opus: null,
    seven_day_sonnet: null,
    seven_day_oauth_apps: null,
    seven_day_cowork: null,
    extra_usage: null,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fleetlens-backfill-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns paired=false when no team config exists", async () => {
    const result = await runTeamBackfill(() => {}, "/nonexistent/path", null);
    expect(result.paired).toBe(false);
  });

  it("returns 0 sent when usage log is empty", async () => {
    const usagePath = join(dir, "empty-usage.jsonl");
    writeFileSync(usagePath, "", "utf8");
    const result = await runTeamBackfill(() => {}, usagePath, fakeConfig);
    expect(result.paired).toBe(true);
    expect(result.sentSnapshots).toBe(0);
    expect(result.batches).toBe(0);
  });

  it("transforms snake_case JSONL to camelCase wire format and posts batches", async () => {
    const usagePath = join(dir, "usage.jsonl");
    const lines = [
      JSON.stringify({
        captured_at: "2026-04-29T02:58:41.717+00:00",
        five_hour: { utilization: 19, resets_at: "2026-04-29T07:10:00+00:00" },
        seven_day: { utilization: 18, resets_at: "2026-05-04T12:00:00+00:00" },
        seven_day_opus: null,
        seven_day_sonnet: { utilization: 3, resets_at: "2026-05-04T12:00:00+00:00" },
        seven_day_oauth_apps: null,
        seven_day_cowork: null,
        extra_usage: { is_enabled: true, monthly_limit: 0, used_credits: 0, utilization: null },
      }),
      JSON.stringify({
        captured_at: "2026-04-29T03:03:41.717+00:00",
        five_hour: { utilization: 20, resets_at: "2026-04-29T07:10:00+00:00" },
        seven_day: { utilization: 18, resets_at: "2026-05-04T12:00:00+00:00" },
        seven_day_opus: null,
        seven_day_sonnet: null,
        seven_day_oauth_apps: null,
        seven_day_cowork: null,
        extra_usage: null,
      }),
    ];
    writeFileSync(usagePath, lines.join("\n") + "\n", "utf8");

    let captured: { url: string; body: unknown } | null = null;
    const originalFetch = global.fetch;
    global.fetch = (async (url: string, init: RequestInit) => {
      captured = { url, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ accepted: true, received: 2, inserted: 2, skipped: 0 }), {
        status: 200,
      });
    }) as typeof fetch;

    try {
      const result = await runTeamBackfill(() => {}, usagePath, fakeConfig);
      expect(result.paired).toBe(true);
      expect(result.sentSnapshots).toBe(2);
      expect(result.insertedSnapshots).toBe(2);
      expect(result.batches).toBe(1);
      expect(captured!.url).toBe("http://localhost:9999/api/ingest/usage-history");
      const body = captured!.body as { snapshots: Array<Record<string, unknown>> };
      expect(body.snapshots).toHaveLength(2);
      expect(body.snapshots[0].capturedAt).toBe("2026-04-29T02:58:41.717+00:00");
      expect((body.snapshots[0].fiveHour as { resetsAt: string }).resetsAt).toBe(
        "2026-04-29T07:10:00+00:00",
      );
      expect((body.snapshots[0].extraUsage as { monthlyLimitUsd: number }).monthlyLimitUsd).toBe(0);
      expect(body.snapshots[1].extraUsage).toBeNull();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("sends only snapshots newer than sinceCapturedAt and reports the high-water mark", async () => {
    const usagePath = join(dir, "usage.jsonl");
    writeFileSync(
      usagePath,
      [
        JSON.stringify({
          captured_at: "2026-04-29T02:58:41.717+00:00",
          five_hour: { utilization: 19, resets_at: "2026-04-29T07:10:00+00:00" },
          seven_day: { utilization: 18, resets_at: "2026-05-04T12:00:00+00:00" },
          seven_day_opus: null,
          seven_day_sonnet: null,
          seven_day_oauth_apps: null,
          seven_day_cowork: null,
          extra_usage: null,
        }),
        JSON.stringify({
          captured_at: "2026-04-29T03:03:41.717+00:00",
          five_hour: { utilization: 20, resets_at: "2026-04-29T07:10:00+00:00" },
          seven_day: { utilization: 22, resets_at: "2026-05-04T12:00:00+00:00" },
          seven_day_opus: null,
          seven_day_sonnet: null,
          seven_day_oauth_apps: null,
          seven_day_cowork: null,
          extra_usage: null,
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    let captured: { body: unknown } | null = null;
    const originalFetch = global.fetch;
    global.fetch = (async (_url: string, init: RequestInit) => {
      captured = { body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ inserted: 1, skipped: 0 }), { status: 200 });
    }) as typeof fetch;

    try {
      const result = await runTeamBackfill(() => {}, usagePath, fakeConfig, {
        sinceCapturedAt: "2026-04-29T02:58:41.717+00:00",
      });
      const body = captured!.body as { snapshots: Array<{ capturedAt: string }> };
      expect(body.snapshots).toHaveLength(1);
      expect(body.snapshots[0].capturedAt).toBe("2026-04-29T03:03:41.717+00:00");
      expect(result.lastSnapshotAt).toBe("2026-04-29T03:03:41.717+00:00");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("sorts snapshots by capture time before posting", async () => {
    const usagePath = join(dir, "usage.jsonl");
    writeFileSync(
      usagePath,
      [
        snapshotLine("2026-04-29T03:03:41.717+00:00", 21),
        snapshotLine("2026-04-29T02:58:41.717+00:00", 19),
      ].join("\n") + "\n",
      "utf8",
    );

    let captured: { body: unknown } | null = null;
    const originalFetch = global.fetch;
    global.fetch = (async (_url: string, init: RequestInit) => {
      captured = { body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ inserted: 2, skipped: 0 }), { status: 200 });
    }) as typeof fetch;

    try {
      const result = await runTeamBackfill(() => {}, usagePath, fakeConfig);
      const body = captured!.body as { snapshots: Array<{ capturedAt: string }> };
      expect(body.snapshots.map((s) => s.capturedAt)).toEqual([
        "2026-04-29T02:58:41.717+00:00",
        "2026-04-29T03:03:41.717+00:00",
      ]);
      expect(result.lastSnapshotAt).toBe("2026-04-29T03:03:41.717+00:00");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("reports an error and stops on a server 4xx", async () => {
    const usagePath = join(dir, "usage.jsonl");
    writeFileSync(
      usagePath,
      JSON.stringify({
        captured_at: "2026-04-29T02:58:41.717+00:00",
        five_hour: { utilization: 19, resets_at: "2026-04-29T07:10:00+00:00" },
        seven_day: { utilization: 18, resets_at: "2026-05-04T12:00:00+00:00" },
        seven_day_opus: null,
        seven_day_sonnet: null,
        seven_day_oauth_apps: null,
        seven_day_cowork: null,
        extra_usage: null,
      }) + "\n",
      "utf8",
    );

    const originalFetch = global.fetch;
    global.fetch = (async () =>
      new Response(JSON.stringify({ error: "Validation failed" }), { status: 400 })) as typeof fetch;

    try {
      const result = await runTeamBackfill(() => {}, usagePath, fakeConfig);
      expect(result.error).toBe("HTTP 400");
      expect(result.insertedSnapshots).toBe(0);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

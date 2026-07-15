import { describe, it, expect } from "vitest";
import {
  parseCodexWhamUsage,
  accessTokenExpiresAtMs,
  needsRefresh,
  CodexApiError,
} from "../../src/usage/codex.js";

describe("parseCodexWhamUsage", () => {
  it("classifies a weekly-only primary_window as seven_day (not five_hour)", () => {
    // Live shape after 5h limit removed: weekly rides in primary with
    // limit_window_seconds=604800 (OpenUsage / WHAM contract).
    const parsed = parseCodexWhamUsage({
      plan_type: "plus",
      rate_limit: {
        primary_window: {
          used_percent: 2,
          limit_window_seconds: 604_800,
          reset_at: 1_784_680_216,
        },
        secondary_window: null,
      },
    });
    expect(parsed.plan_type).toBe("plus");
    expect(parsed.five_hour).toEqual({ utilization: null, resets_at: null });
    expect(parsed.seven_day.utilization).toBe(2);
    expect(parsed.seven_day.resets_at).toBe(
      new Date(1_784_680_216 * 1000).toISOString(),
    );
  });

  it("maps dual windows by duration, not primary/secondary slot order", () => {
    const parsed = parseCodexWhamUsage({
      rate_limit: {
        // Intentionally swapped slots — duration wins.
        primary_window: {
          used_percent: 40,
          limit_window_seconds: 604_800,
          reset_at: 2_000_000_000,
        },
        secondary_window: {
          used_percent: 10,
          limit_window_seconds: 18_000,
          reset_at: 1_900_000_000,
        },
      },
    });
    expect(parsed.five_hour.utilization).toBe(10);
    expect(parsed.seven_day.utilization).toBe(40);
  });

  it("falls back to primary=5h / secondary=7d when duration is absent", () => {
    const parsed = parseCodexWhamUsage({
      rate_limit: {
        primary_window: { used_percent: 55, reset_at: 2_000_000_000 },
        secondary_window: { used_percent: 12, reset_at: 2_100_000_000 },
      },
    });
    expect(parsed.five_hour.utilization).toBe(55);
    expect(parsed.seven_day.utilization).toBe(12);
  });

  it("fills missing body percents from x-codex-* headers", () => {
    const parsed = parseCodexWhamUsage(
      {
        rate_limit: {
          primary_window: {
            limit_window_seconds: 18_000,
            reset_at: 2_000_000_000,
          },
          secondary_window: {
            limit_window_seconds: 604_800,
            reset_at: 2_100_000_000,
          },
        },
      },
      {
        "x-codex-primary-used-percent": "7",
        "x-codex-secondary-used-percent": "33",
      },
    );
    expect(parsed.five_hour.utilization).toBe(7);
    expect(parsed.seven_day.utilization).toBe(33);
  });

  it("derives resets_at from reset_after_seconds when reset_at is absent", () => {
    const now = Date.parse("2026-07-15T00:00:00.000Z");
    const parsed = parseCodexWhamUsage(
      {
        rate_limit: {
          primary_window: {
            used_percent: 1,
            limit_window_seconds: 604_800,
            reset_after_seconds: 3600,
          },
        },
      },
      {},
      now,
    );
    expect(parsed.seven_day.resets_at).toBe("2026-07-15T01:00:00.000Z");
  });

  it("rejects a non-object body", () => {
    expect(() => parseCodexWhamUsage(null)).toThrow(CodexApiError);
  });
});

describe("accessTokenExpiresAtMs", () => {
  it("reads exp from a JWT payload", () => {
    const payload = Buffer.from(
      JSON.stringify({ exp: 1_784_369_507 }),
      "utf8",
    ).toString("base64url");
    const token = `hdr.${payload}.sig`;
    expect(accessTokenExpiresAtMs(token)).toBe(1_784_369_507 * 1000);
  });

  it("returns null for non-JWT tokens", () => {
    expect(accessTokenExpiresAtMs("not-a-jwt")).toBeNull();
  });
});

describe("needsRefresh", () => {
  const now = Date.parse("2026-07-15T12:00:00.000Z");

  it("uses JWT exp with a 5-minute buffer", () => {
    const expSec = Math.floor(now / 1000) + 60; // expires in 1 minute
    const payload = Buffer.from(JSON.stringify({ exp: expSec }), "utf8").toString(
      "base64url",
    );
    const token = `hdr.${payload}.sig`;
    expect(needsRefresh(token, undefined, now)).toBe(true);

    const farExp = Math.floor(now / 1000) + 3600;
    const far = Buffer.from(JSON.stringify({ exp: farExp }), "utf8").toString(
      "base64url",
    );
    expect(needsRefresh(`hdr.${far}.sig`, undefined, now)).toBe(false);
  });

  it("falls back to 8-day last_refresh wall-clock when JWT is undecodable", () => {
    const nineDaysAgo = new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString();
    expect(needsRefresh("not-a-jwt", nineDaysAgo, now)).toBe(true);

    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(needsRefresh("not-a-jwt", sevenDaysAgo, now)).toBe(false);
  });

  it("does not refresh a brand-new non-JWT login without last_refresh", () => {
    expect(needsRefresh("not-a-jwt", undefined, now)).toBe(false);
  });
});

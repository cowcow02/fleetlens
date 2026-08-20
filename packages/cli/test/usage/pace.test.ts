import { describe, it, expect } from "vitest";
import {
  addUtcMonths,
  monthlyWindowMs,
  paceForSnapshot,
  paceForWindow,
  paceVerdict,
  SEVEN_DAYS_MS,
  windowPace,
} from "../../src/usage/pace.js";

const DAY = 24 * 60 * 60 * 1000;

describe("paceVerdict", () => {
  it("treats ±15pp as on track", () => {
    expect(paceVerdict(-15)).toBe("on_track");
    expect(paceVerdict(0)).toBe("on_track");
    expect(paceVerdict(15)).toBe("on_track");
  });

  it("calls used>>elapsed fast and elapsed>>used slow", () => {
    expect(paceVerdict(-15.1)).toBe("fast");
    expect(paceVerdict(15.1)).toBe("slow");
  });
});

describe("windowPace", () => {
  it("is on track when used matches elapsed", () => {
    const now = Date.parse("2026-08-20T12:00:00Z");
    const resets = now + 3.5 * DAY;
    const pace = windowPace({
      usedPct: 50,
      resetsAtMs: resets,
      windowMs: SEVEN_DAYS_MS,
      nowMs: now,
    });
    expect(pace).toEqual({
      used_pct: 50,
      elapsed_pct: 50,
      delta_pp: 0,
      verdict: "on_track",
    });
  });

  it("is slow when the window is half gone and almost unused", () => {
    const now = Date.parse("2026-08-20T12:00:00Z");
    const pace = windowPace({
      usedPct: 2,
      resetsAtMs: now + 3.5 * DAY,
      windowMs: SEVEN_DAYS_MS,
      nowMs: now,
    });
    expect(pace?.verdict).toBe("slow");
    expect(pace?.delta_pp).toBe(48);
  });

  it("is fast when used is far ahead of elapsed", () => {
    const now = Date.parse("2026-08-20T12:00:00Z");
    const pace = windowPace({
      usedPct: 90,
      resetsAtMs: now + 6 * DAY,
      windowMs: SEVEN_DAYS_MS,
      nowMs: now,
    });
    expect(pace?.verdict).toBe("fast");
    expect(pace?.elapsed_pct).toBeCloseTo(14.3, 0);
    expect(pace!.delta_pp).toBeLessThan(-15);
  });

  it("clamps elapsed to 0..100 when now is outside the window", () => {
    const resets = Date.parse("2026-08-20T12:00:00Z");
    const before = windowPace({
      usedPct: 10,
      resetsAtMs: resets,
      windowMs: SEVEN_DAYS_MS,
      nowMs: resets - 8 * DAY,
    });
    expect(before?.elapsed_pct).toBe(0);
    const after = windowPace({
      usedPct: 10,
      resetsAtMs: resets,
      windowMs: SEVEN_DAYS_MS,
      nowMs: resets + DAY,
    });
    expect(after?.elapsed_pct).toBe(100);
    expect(after?.verdict).toBe("slow");
  });

  it("returns null for a zero-length window", () => {
    expect(
      windowPace({ usedPct: 10, resetsAtMs: 1, windowMs: 0, nowMs: 1 }),
    ).toBeNull();
  });
});

describe("monthlyWindowMs", () => {
  it("uses the UTC calendar month ending at a 1st-of-month Copilot reset", () => {
    const resets = new Date("2026-03-01T00:00:00.000Z");
    expect(monthlyWindowMs(resets)).toBe(28 * DAY);
  });

  it("uses one calendar month before a mid-month Command Code period end", () => {
    const resets = new Date("2026-09-17T03:06:55.000Z");
    const start = addUtcMonths(resets, -1);
    expect(start.toISOString()).toBe("2026-08-17T03:06:55.000Z");
    expect(monthlyWindowMs(resets)).toBe(resets.getTime() - start.getTime());
  });

  it("clamps March 31 minus one month onto February's last day", () => {
    expect(addUtcMonths(new Date("2026-03-31T00:00:00.000Z"), -1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });
});

describe("paceForWindow / paceForSnapshot", () => {
  it("skips windows with no reset time", () => {
    expect(paceForWindow({ utilization: 40, resets_at: null }, "seven_day")).toBeNull();
    expect(paceForSnapshot({ seven_day: { utilization: 40, resets_at: null } })).toBeUndefined();
  });

  it("scores 7d and monthly independently", () => {
    const now = Date.parse("2026-08-20T03:12:00Z");
    const pace = paceForSnapshot(
      {
        seven_day: { utilization: 45, resets_at: "2026-08-24T12:00:00.000Z" },
        monthly: { utilization: 0, resets_at: "2026-09-01T00:00:00.000Z" },
      },
      now,
    );
    expect(pace?.seven_day?.verdict).toBe("on_track");
    expect(pace?.monthly?.verdict).toBe("slow");
    expect(pace?.monthly?.used_pct).toBe(0);
  });
});

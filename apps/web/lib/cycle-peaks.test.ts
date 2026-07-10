import { describe, it, expect } from "vitest";
import {
  previousCyclesTrend,
  type CalibrationCurvePoint,
  type CalibrationLike,
} from "./cycle-peaks";

function dump(curve: CalibrationCurvePoint[]): CalibrationLike {
  return { curve };
}

function point(overrides: Partial<CalibrationCurvePoint>): CalibrationCurvePoint {
  return {
    ts: "2026-05-01T00:00:00.000Z",
    real_5h: null,
    pred_5h: 0,
    real_7d: null,
    pred_7d: 0,
    cycle_end_5h: null,
    cycle_end_7d: null,
    ...overrides,
  };
}

const NOW = Date.parse("2026-05-08T00:00:00.000Z");

describe("previousCyclesTrend (7d)", () => {
  it("merges two cycle ends within 12 h into a single cycle, latest endsAt + max peak", () => {
    // Regression: Anthropic's rolling 7-day window slid its anchor between
    // two polls on the same day, producing two distinct hour-buckets.
    // Without the merge, /usage and the team-server both rendered two
    // bars labeled the same day.
    const result = previousCyclesTrend(
      dump([
        point({ cycle_end_7d: "2026-05-07T07:00:00.000Z", real_7d: 6 }),
        point({ cycle_end_7d: "2026-05-07T09:00:00.000Z", real_7d: 91 }),
      ]),
      "7d",
      6,
      NOW,
    );
    expect(result).toHaveLength(1);
    expect(result[0].endsAt).toBe("2026-05-07T09:00:00.000Z");
    expect(result[0].peakPct).toBe(91);
    expect(result[0].source).toBe("real");
  });

  it("keeps cycles 7 d apart as distinct entries", () => {
    const result = previousCyclesTrend(
      dump([
        point({ cycle_end_7d: "2026-04-30T12:00:00.000Z", real_7d: 50 }),
        point({ cycle_end_7d: "2026-05-07T12:00:00.000Z", real_7d: 80 }),
      ]),
      "7d",
      6,
      NOW,
    );
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.endsAt)).toEqual([
      "2026-04-30T12:00:00.000Z",
      "2026-05-07T12:00:00.000Z",
    ]);
  });

  it("collapses millisecond-jitter on the same reset boundary", () => {
    const result = previousCyclesTrend(
      dump([
        point({ cycle_end_7d: "2026-05-07T12:00:00.123Z", real_7d: 40 }),
        point({ cycle_end_7d: "2026-05-07T12:00:00.999Z", real_7d: 60 }),
      ]),
      "7d",
      6,
      NOW,
    );
    expect(result).toHaveLength(1);
    expect(result[0].peakPct).toBe(60);
  });

  it("takes max across real AND predicted, preferring real when it wins", () => {
    const result = previousCyclesTrend(
      dump([
        point({ cycle_end_7d: "2026-05-07T12:00:00.000Z", real_7d: 30, pred_7d: 20 }),
        point({ cycle_end_7d: "2026-05-07T12:00:00.000Z", real_7d: 50, pred_7d: 40 }),
      ]),
      "7d",
      6,
      NOW,
    );
    expect(result[0].peakPct).toBe(50);
    expect(result[0].source).toBe("real");
  });

  it("falls back to predicted when no real value is recorded", () => {
    const result = previousCyclesTrend(
      dump([
        point({ cycle_end_7d: "2026-05-07T12:00:00.000Z", pred_7d: 70 }),
        point({ cycle_end_7d: "2026-05-07T12:00:00.000Z", pred_7d: 40 }),
      ]),
      "7d",
      6,
      NOW,
    );
    expect(result[0].peakPct).toBe(70);
    expect(result[0].source).toBe("predicted");
  });

  it("clamps a runaway predicted peak to 100 but never clamps a real reading", () => {
    // Predicted utilization is a forward extrapolation with no upper anchor:
    // once the daemon stops recording, a heavy-spend stretch drives it past
    // 100pp (observed: 149% for the Jun-2026 gap). Utilization is a share of
    // the plan limit, so a predicted peak above 100 is a rendering bug — the
    // bar overflows the axis. Real readings stay untouched: extra-usage
    // overage can legitimately exceed 100.
    const clamped = previousCyclesTrend(
      dump([
        point({ cycle_end_7d: "2026-05-07T08:00:00.000Z", pred_7d: 42 }),
        point({ cycle_end_7d: "2026-05-07T08:00:00.000Z", pred_7d: 148.9 }),
      ]),
      "7d",
      6,
      NOW,
    );
    expect(clamped[0]!.peakPct).toBe(100);
    expect(clamped[0]!.source).toBe("predicted");

    const real = previousCyclesTrend(
      dump([
        point({ cycle_end_7d: "2026-05-07T08:00:00.000Z", real_7d: 12 }),
        point({ cycle_end_7d: "2026-05-07T08:00:00.000Z", real_7d: 118 }),
      ]),
      "7d",
      6,
      NOW,
    );
    expect(real[0]!.peakPct).toBe(118);
    expect(real[0]!.source).toBe("real");
  });

  it("respects maxCycles by returning the most recent N", () => {
    const result = previousCyclesTrend(
      dump([
        point({ cycle_end_7d: "2026-04-02T00:00:00.000Z", real_7d: 10 }),
        point({ cycle_end_7d: "2026-04-09T00:00:00.000Z", real_7d: 20 }),
        point({ cycle_end_7d: "2026-04-16T00:00:00.000Z", real_7d: 0.3 }),
        point({ cycle_end_7d: "2026-04-23T00:00:00.000Z", real_7d: 40 }),
      ]),
      "7d",
      2,
      NOW,
    );
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.endsAt)).toEqual([
      "2026-04-16T00:00:00.000Z",
      "2026-04-23T00:00:00.000Z",
    ]);
  });

  it("flags the future-ending cycle as current", () => {
    const result = previousCyclesTrend(
      dump([
        point({ cycle_end_7d: "2026-05-01T00:00:00.000Z", real_7d: 50 }),
        point({ cycle_end_7d: "2026-05-09T00:00:00.000Z", real_7d: 0.7 }),
      ]),
      "7d",
      6,
      NOW,
    );
    expect(result.find((r) => r.endsAt.startsWith("2026-05-01"))?.current).toBe(false);
    expect(result.find((r) => r.endsAt.startsWith("2026-05-09"))?.current).toBe(true);
  });

  it("re-baselines the ongoing cycle after a mid-cycle limit reset", () => {
    // Regression: Claude reset the usage limit overnight — utilization
    // dropped 88% → 20% within the SAME cycle. The pre-reset 88% belongs
    // to the superseded limit and must not anchor the ongoing bar, which
    // should reflect the post-reset reality (~20%). Completed cycles keep
    // their all-time max.
    const result = previousCyclesTrend(
      dump([
        point({
          ts: "2026-05-07T00:00:00.000Z",
          cycle_end_7d: "2026-05-08T00:00:00.000Z",
          real_7d: 40,
        }),
        point({
          ts: "2026-05-07T12:00:00.000Z",
          cycle_end_7d: "2026-05-14T00:00:00.000Z",
          real_7d: 88,
        }),
        point({
          ts: "2026-05-07T13:00:00.000Z",
          cycle_end_7d: "2026-05-14T00:00:00.000Z",
          real_7d: 20,
        }),
        point({
          ts: "2026-05-07T18:00:00.000Z",
          cycle_end_7d: "2026-05-14T00:00:00.000Z",
          real_7d: 33,
        }),
      ]),
      "7d",
      6,
      NOW,
    );
    // The 7d-tolerance merge collapses the two completed-cycle points into
    // one bar (peak 40); the post-reset ongoing cycle bar is separate.
    const ongoing = result.find((r) => r.current);
    expect(ongoing).toBeDefined();
    expect(ongoing!.peakPct).toBe(33);
    expect(ongoing!.source).toBe("real");
  });

  it("keeps the completed cycle peak at its all-time max even when it had a reset", () => {
    // Completed cycles are historical records — a mid-cycle reset there
    // doesn't get rebaselined; the truthful peak is the max reading.
    const result = previousCyclesTrend(
      dump([
        point({
          ts: "2026-05-01T00:00:00.000Z",
          cycle_end_7d: "2026-05-06T00:00:00.000Z",
          real_7d: 75,
        }),
        point({
          ts: "2026-05-02T00:00:00.000Z",
          cycle_end_7d: "2026-05-06T00:00:00.000Z",
          real_7d: 25,
        }),
      ]),
      "7d",
      6,
      NOW,
    );
    const completed = result.find((r) => !r.current);
    expect(completed!.peakPct).toBe(75);
  });

  it("returns empty when the dump is null or has fewer than two points", () => {
    expect(previousCyclesTrend(null, "7d", 6, NOW)).toEqual([]);
    expect(
      previousCyclesTrend(
        dump([point({ cycle_end_7d: "2026-05-07T12:00:00.000Z" })]),
        "7d",
        6,
        NOW,
      ),
    ).toEqual([]);
  });

  it("skips points missing the cycle key", () => {
    const result = previousCyclesTrend(
      dump([
        point({ cycle_end_7d: null, real_7d: 50 }),
        point({ cycle_end_7d: "2026-05-07T12:00:00.000Z", real_7d: 40 }),
      ]),
      "7d",
      6,
      NOW,
    );
    expect(result).toHaveLength(1);
    expect(result[0].peakPct).toBe(40);
  });
});

describe("previousCyclesTrend (5h)", () => {
  it("keeps two 5h cycle ends as distinct entries (no merge tolerance for 5h)", () => {
    const result = previousCyclesTrend(
      dump([
        point({ cycle_end_5h: "2026-05-07T10:00:00.000Z", real_5h: 30 }),
        point({ cycle_end_5h: "2026-05-07T15:00:00.000Z", real_5h: 70 }),
      ]),
      "5h",
      6,
      NOW,
    );
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.endsAt)).toEqual([
      "2026-05-07T10:00:00.000Z",
      "2026-05-07T15:00:00.000Z",
    ]);
    expect(result.map((r) => r.peakPct)).toEqual([30, 70]);
  });
});

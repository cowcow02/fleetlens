import { describe, it, expect } from "vitest";
import {
  buildSpendIndex,
  collectSnapPairRates,
  dollarsInRange,
  eventDollars,
  groupSnapsByCycle,
  modelFamily,
  predictAnchored,
  PRICES,
  userSoloRate,
  type CalibrationEvent,
  type CycleSnap,
  type SnapshotForCalibration,
} from "../src/calibration.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Synthetic events evenly spaced across [start, end), priced to total
// `targetDollars` under sonnet rates ($3/M input).
function eventsCosting(startMs: number, endMs: number, targetDollars: number, n = 48): CalibrationEvent[] {
  if (n <= 0 || targetDollars <= 0) return [];
  const stride = (endMs - startMs) / n;
  const totalInputTokens = (targetDollars / 3) * 1_000_000;
  const perTurn = Math.max(1, Math.floor(totalInputTokens / n));
  const out: CalibrationEvent[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      ts: new Date(startMs + i * stride).toISOString(),
      family: "sonnet",
      input: perTurn,
      output: 0,
      cacheRead: 0,
      cache_1h: 0,
      cache_5m: 0,
    });
  }
  return out;
}

describe("buildSpendIndex / dollarsInRange", () => {
  it("matches a manual sum across windows", () => {
    const events = eventsCosting(1_000_000, 1_000_000 + DAY, 240);
    const idx = buildSpendIndex(events);
    expect(dollarsInRange(idx, 0, Number.MAX_SAFE_INTEGER)).toBeCloseTo(240, 0);
    expect(dollarsInRange(idx, 1_000_000, 1_000_000 + DAY / 2)).toBeCloseTo(120, 0);
  });

  it("returns 0 for empty windows", () => {
    expect(dollarsInRange(buildSpendIndex([]), 0, 1)).toBe(0);
  });
});

describe("groupSnapsByCycle", () => {
  it("groups snapshots by hour-rounded resets_at and sorts by ts", () => {
    const cycleEnd = Date.parse("2026-04-21T05:00:00Z");
    const snaps: SnapshotForCalibration[] = [
      { captured_at: "2026-04-15T10:00:00Z", seven_day: { utilization: 20, resets_at: new Date(cycleEnd).toISOString() } },
      { captured_at: "2026-04-14T10:00:00Z", seven_day: { utilization: 5, resets_at: new Date(cycleEnd).toISOString() } },
      { captured_at: "2026-04-15T10:00:00Z", seven_day: null },
    ];
    const groups = groupSnapsByCycle(snaps, (s) => s.seven_day);
    const arr = groups.get(cycleEnd);
    expect(arr).toBeDefined();
    expect(arr!.length).toBe(2);
    expect(arr![0]!.pct).toBe(5);
    expect(arr![1]!.pct).toBe(20);
  });
});

describe("collectSnapPairRates / userSoloRate", () => {
  it("builds one pair-rate per adjacent in-cycle snap pair", () => {
    const cycleEnd = Date.parse("2026-04-21T05:00:00Z");
    const cycleStart = cycleEnd - 7 * DAY;
    // Three snaps: pp 0 → 20 → 50. $200 between snap 1-2, $300 between 2-3.
    const snaps: SnapshotForCalibration[] = [
      { captured_at: new Date(cycleStart).toISOString(),                seven_day: { utilization: 0,  resets_at: new Date(cycleEnd).toISOString() } },
      { captured_at: new Date(cycleStart + 2 * DAY).toISOString(),      seven_day: { utilization: 20, resets_at: new Date(cycleEnd).toISOString() } },
      { captured_at: new Date(cycleStart + 4 * DAY).toISOString(),      seven_day: { utilization: 50, resets_at: new Date(cycleEnd).toISOString() } },
    ];
    const events = [
      ...eventsCosting(cycleStart,             cycleStart + 2 * DAY, 200, 60),
      ...eventsCosting(cycleStart + 2 * DAY,   cycleStart + 4 * DAY, 300, 60),
    ];
    const groups = groupSnapsByCycle(snaps, (s) => s.seven_day);
    const pairs = collectSnapPairRates(groups, buildSpendIndex(events), {
      maxGapMs: 7 * DAY,
    });
    expect(pairs.length).toBe(2);
    // $200 / 20pp = $10/pp ; $300 / 30pp = $10/pp
    expect(pairs[0]!.rate).toBeCloseTo(10, 0);
    expect(pairs[1]!.rate).toBeCloseTo(10, 0);
  });

  it("filters out pairs below the noise floor (travel, dollars, gap)", () => {
    const cycleEnd = Date.parse("2026-04-21T05:00:00Z");
    const cycleStart = cycleEnd - 7 * DAY;
    const snaps: SnapshotForCalibration[] = [
      // Tiny travel (0pp) — should be dropped
      { captured_at: new Date(cycleStart).toISOString(),               seven_day: { utilization: 5, resets_at: new Date(cycleEnd).toISOString() } },
      { captured_at: new Date(cycleStart + 5 * 60_000).toISOString(),  seven_day: { utilization: 5, resets_at: new Date(cycleEnd).toISOString() } },
    ];
    const events = eventsCosting(cycleStart, cycleStart + DAY, 50);
    const groups = groupSnapsByCycle(snaps, (s) => s.seven_day);
    const pairs = collectSnapPairRates(groups, buildSpendIndex(events));
    expect(pairs.length).toBe(0);
  });

  it("p90 picks the upper-percentile rate (= solo-rate proxy)", () => {
    const pairs = [10, 11, 12, 13, 14, 15, 16, 17, 18, 50].map((rate, i) => ({
      cycleEndMs: i,
      rate,
      travel: 10,
      dollars: rate * 10,
      gapMs: HOUR,
    }));
    expect(userSoloRate(pairs, 0.9)).toBe(50);
    expect(userSoloRate(pairs, 0.5)).toBe(15);
    // Below the noise floor of 3 pairs: returns null.
    expect(userSoloRate(pairs.slice(0, 2), 0.9)).toBeNull();
  });
});

describe("predictAnchored", () => {
  it("returns the real value at every snapshot ts (zero error on observed)", () => {
    const cycleEnd = Date.parse("2026-04-21T05:00:00Z");
    const cycleStart = cycleEnd - 7 * DAY;
    const snaps: CycleSnap[] = [
      { ts: cycleStart, pct: 0 },
      { ts: cycleStart + 3 * DAY, pct: 30 },
      { ts: cycleStart + 6 * DAY, pct: 80 },
    ];
    const events = eventsCosting(cycleStart, cycleStart + 6 * DAY, 800, 100);
    const spend = buildSpendIndex(events);
    for (const s of snaps) {
      const p = predictAnchored(spend, snaps, 12, cycleEnd, 168, s.ts);
      expect(p).toBeCloseTo(s.pct, 1);
    }
  });

  it("interpolates spend-weighted between two adjacent snaps", () => {
    const cycleEnd = Date.parse("2026-04-21T05:00:00Z");
    const cycleStart = cycleEnd - 7 * DAY;
    const a = { ts: cycleStart, pct: 0 };
    const b = { ts: cycleStart + 4 * DAY, pct: 40 };
    // Spend back-loaded: $0 first 3 days, $400 over the last day.
    const events = eventsCosting(cycleStart + 3 * DAY, cycleStart + 4 * DAY, 400, 60);
    const spend = buildSpendIndex(events);
    const tDay3 = cycleStart + 3 * DAY;
    expect(predictAnchored(spend, [a, b], 12, cycleEnd, 168, tDay3)).toBeCloseTo(0, 0);
    const tHalf = cycleStart + 3.5 * DAY;
    const pHalf = predictAnchored(spend, [a, b], 12, cycleEnd, 168, tHalf);
    expect(pHalf).toBeGreaterThan(15);
    expect(pHalf).toBeLessThan(25);
  });

  it("forward-extrapolates past the last snap using the supplied rate", () => {
    const cycleEnd = Date.parse("2026-04-21T05:00:00Z");
    const cycleStart = cycleEnd - 7 * DAY;
    const lastSnapTs = cycleStart + 5 * DAY;
    const snaps: CycleSnap[] = [
      { ts: cycleStart, pct: 0 },
      { ts: lastSnapTs, pct: 50 },
    ];
    // $50 spent in the forward window. forwardRate=$10/pp → +5pp predicted.
    const events = eventsCosting(lastSnapTs, lastSnapTs + DAY, 50, 24);
    const spend = buildSpendIndex(events);
    const p = predictAnchored(spend, snaps, 10, cycleEnd, 168, lastSnapTs + DAY);
    expect(p).toBeGreaterThan(53);
    expect(p).toBeLessThan(57);
  });

  it("higher forwardRate → less predicted travel for same $-spent (solo-rate fix)", () => {
    const cycleEnd = Date.parse("2026-04-21T05:00:00Z");
    const cycleStart = cycleEnd - 7 * DAY;
    const lastSnapTs = cycleStart + 5 * DAY;
    const snaps: CycleSnap[] = [
      { ts: cycleStart, pct: 0 },
      { ts: lastSnapTs, pct: 45 },
    ];
    const events = eventsCosting(lastSnapTs, lastSnapTs + DAY, 544, 200);
    const spend = buildSpendIndex(events);
    const t = lastSnapTs + DAY;
    const lowRate = predictAnchored(spend, snaps, 10.25, cycleEnd, 168, t);
    const highRate = predictAnchored(spend, snaps, 22, cycleEnd, 168, t);
    expect(lowRate).toBeGreaterThan(highRate);
    // 45 + 544/22 ≈ 70%, 45 + 544/10.25 ≈ 98%.
    expect(highRate).toBeCloseTo(70, 0);
    expect(lowRate).toBeCloseTo(98, 0);
  });

  it("anchors pre-first-snap to (cycleStart, 0) for a clean reset on the cycle boundary", () => {
    const cycleEnd = Date.parse("2026-04-21T05:00:00Z");
    const cycleStart = cycleEnd - 7 * DAY;
    const firstObs = cycleStart + 12 * HOUR;
    const snaps: CycleSnap[] = [{ ts: firstObs, pct: 8 }];
    // $40 spent across the 12h pre-observation window
    const events = eventsCosting(cycleStart, firstObs, 40, 60);
    const spend = buildSpendIndex(events);
    // At cycle boundary itself: clean reset, predicted = 0.
    expect(predictAnchored(spend, snaps, 22, cycleEnd, 168, cycleStart)).toBe(0);
    // At the first observation: anchored exactly at first.pct = 8.
    expect(predictAnchored(spend, snaps, 22, cycleEnd, 168, firstObs)).toBeCloseTo(8, 1);
    // Halfway through pre-observation $-fraction → halfway to first.pct.
    const tHalf = cycleStart + 6 * HOUR;
    const pHalf = predictAnchored(spend, snaps, 22, cycleEnd, 168, tHalf);
    expect(pHalf).toBeGreaterThan(3);
    expect(pHalf).toBeLessThan(5);
  });

  it("uses the supplied rate for cycles with no observations yet", () => {
    const cycleEnd = Date.parse("2026-04-21T05:00:00Z");
    const cycleStart = cycleEnd - 7 * DAY;
    const events = eventsCosting(cycleStart, cycleStart + DAY, 24, 24);
    const spend = buildSpendIndex(events);
    const t = cycleStart + DAY;
    expect(predictAnchored(spend, [], 12, cycleEnd, 168, t)).toBeCloseTo(2, 0);
  });
});


describe("modelFamily", () => {
  it("maps case variants to canonical families", () => {
    expect(modelFamily("claude-opus-4-7")).toBe("opus");
    expect(modelFamily("CLAUDE-Opus-4-8")).toBe("opus");
    expect(modelFamily("claude-sonnet-4-6")).toBe("sonnet");
    expect(modelFamily("claude-haiku-4-5-20251001")).toBe("haiku");
  });
  it("returns null for non-Anthropic and sentinel values", () => {
    expect(modelFamily("gpt-4-turbo")).toBeNull();
    expect(modelFamily("glm-4.5")).toBeNull();
    expect(modelFamily("<synthetic>")).toBeNull();
    expect(modelFamily(undefined)).toBeNull();
    expect(modelFamily(null)).toBeNull();
    expect(modelFamily("")).toBeNull();
  });
});

describe("eventDollars", () => {
  it("prices a sonnet event by summing input/output/cache rates", () => {
    const ev: CalibrationEvent = {
      ts: "2026-04-10T00:00:00Z",
      family: "sonnet",
      input: 1_000_000,
      output: 0,
      cacheRead: 0,
      cache_1h: 0,
      cache_5m: 0,
    };
    // 1M input × $3 / 1M = $3
    expect(eventDollars(ev)).toBeCloseTo(PRICES.sonnet.input, 6);
  });
  it("opus is priced 5x sonnet input", () => {
    const inp: CalibrationEvent = { ts: "x", family: "opus", input: 1_000_000, output: 0, cacheRead: 0, cache_1h: 0, cache_5m: 0 };
    expect(eventDollars(inp)).toBeCloseTo(PRICES.opus.input, 6);
  });
  it("returns 0 for empty usage", () => {
    expect(eventDollars({ ts: "x", family: "sonnet", input: 0, output: 0, cacheRead: 0, cache_1h: 0, cache_5m: 0 })).toBe(0);
  });
});


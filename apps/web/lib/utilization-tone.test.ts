import { describe, it, expect } from "vitest";
import { utilizationTone, paceLabel, paceToneForCycle, UTILIZATION_THRESHOLDS } from "./utilization-tone";

describe("utilizationTone", () => {
  it("flips at the 70 / 40 thresholds documented in the file", () => {
    expect(utilizationTone(70)).toBe("success");
    expect(utilizationTone(69.9)).toBe("warning");
    expect(utilizationTone(40)).toBe("warning");
    expect(utilizationTone(39.9)).toBe("danger");
    expect(utilizationTone(0)).toBe("danger");
    expect(utilizationTone(100)).toBe("success");
  });
  it("exposes the same thresholds as constants", () => {
    expect(UTILIZATION_THRESHOLDS.good).toBe(70);
    expect(UTILIZATION_THRESHOLDS.low).toBe(40);
  });
});

describe("paceLabel", () => {
  it("uses a ±15pp band around zero delta", () => {
    expect(paceLabel(-15.1).tone).toBe("danger");
    expect(paceLabel(-15).tone).toBe("success");
    expect(paceLabel(0).tone).toBe("success");
    expect(paceLabel(15).tone).toBe("success");
    expect(paceLabel(15.1).tone).toBe("warning");
  });
  it("returns the right human label per band", () => {
    expect(paceLabel(-20).label).toBe("may exhaust early");
    expect(paceLabel(20).label).toBe("below pace");
    expect(paceLabel(5).label).toBe("on pace");
  });
});

describe("paceToneForCycle", () => {
  const DAY = 24 * 60 * 60 * 1000;
  it("at the start of a 7d cycle, low usage reads as on-pace (success)", () => {
    const cycleEnd = 1_000_000_000;
    const window = 7 * DAY;
    const justStarted = cycleEnd - window + 5 * 60_000;
    expect(paceToneForCycle(2, cycleEnd, window, justStarted)).toBe("success");
  });
  it("at the end of the cycle, very low usage reads as below-pace (warning)", () => {
    const cycleEnd = 1_000_000_000;
    const window = 7 * DAY;
    const nearEnd = cycleEnd - DAY / 4;
    // Ideal used ~96%, actual 50% → delta ~+46 → below pace.
    expect(paceToneForCycle(50, cycleEnd, window, nearEnd)).toBe("warning");
  });
  it("burning faster than the ideal reads as danger (may exhaust early)", () => {
    const cycleEnd = 1_000_000_000;
    const window = 7 * DAY;
    // Halfway through (ideal ~50%) but burned ~80% → delta -30 → danger.
    const mid = cycleEnd - window / 2;
    expect(paceToneForCycle(80, cycleEnd, window, mid)).toBe("danger");
  });
});

import { describe, it, expect } from "vitest";
import { liveness } from "../../src/app/team/[slug]/members/[id]/sync-liveness";

const NOW = Date.UTC(2026, 6, 6, 12, 0, 0);

describe("liveness", () => {
  it("null heartbeat is stale (never seen) — drives the broken-transport copy", () => {
    const l = liveness(null, NOW);
    expect(l.stale).toBe(true);
    expect(l.label).toBe("never");
  });

  it("a heartbeat older than 30 min is stale", () => {
    const l = liveness(NOW - 31 * 60_000, NOW);
    expect(l.stale).toBe(true);
    expect(l.color).toBe("#e8b866"); // amber
    expect(l.label).toBe("31m ago");
  });

  it("exactly 30 min is the stale boundary (>= 30 min)", () => {
    expect(liveness(NOW - 30 * 60_000, NOW).stale).toBe(true);
    expect(liveness(NOW - (30 * 60_000 - 1), NOW).stale).toBe(false);
  });

  it("a recent heartbeat is live (green, not stale)", () => {
    const l = liveness(NOW - 90_000, NOW);
    expect(l.stale).toBe(false);
    expect(l.color).toBe("#6fcf8e"); // green
    expect(l.label).toBe("2m ago");
  });

  it("sub-minute reads as 'just now'", () => {
    expect(liveness(NOW - 10_000, NOW).label).toBe("just now");
  });

  it("hour- and day-scale labels", () => {
    expect(liveness(NOW - 3 * 3_600_000, NOW).label).toBe("3h ago");
    expect(liveness(NOW - 2 * 86_400_000, NOW).label).toBe("2d ago");
  });
});

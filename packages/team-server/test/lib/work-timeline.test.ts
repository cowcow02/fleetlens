import { describe, it, expect } from "vitest";
import { workTimelineStats, type WorkTimelineRow } from "../../src/lib/team-report-aggregate.js";

const T0 = "2026-06-01T08:00:00Z";
const h = (hours: number) => new Date(Date.parse(T0) + hours * 3600_000).toISOString();

function row(patch: Partial<WorkTimelineRow> = {}): WorkTimelineRow {
  // Clean chain: 2h queue, 4h build (pickup → PR), 4h review (PR → merge). 500 lines → S.
  return {
    created_at: h(0),
    started_at: h(2),
    first_pr_created: h(6),
    last_merged: h(10),
    estimate: null,
    lines_changed: 500,
    ...patch,
  };
}

describe("workTimelineStats", () => {
  it("decomposes a clean chain into build and review", () => {
    const s = workTimelineStats([row()], [], 0);
    expect(s.week.build.median_hours).toBe(4);
    expect(s.week.review.median_hours).toBe(4);
  });

  it("keeps queue out of the phases, as a footnote median only", () => {
    const s = workTimelineStats([row()], [], 0);
    expect(s.queue_median_hours).toBe(2);
    expect(Object.keys(s.week)).toEqual(["build", "review"]);
  });

  it("reports median and p90 per phase", () => {
    // Review waits of 1..10h → median 5.5, p90 (linear interp) 9.1.
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ first_pr_created: h(6), last_merged: h(7 + i) }),
    );
    const s = workTimelineStats(rows, [], 0);
    expect(s.week.review.median_hours).toBe(5.5);
    expect(s.week.review.p90_hours).toBe(9.1);
  });

  it("clamps build to 0 when the PR predates the status flip", () => {
    const s = workTimelineStats([row({ started_at: h(7) })], [], 0);
    expect(s.week.build.median_hours).toBe(0);
  });

  it("drops negative review phases instead of polluting the median", () => {
    // Merge timestamp before PR creation — bad data, not a real phase.
    const s = workTimelineStats([row({ last_merged: h(5) })], [], 0);
    expect(s.week.review.median_hours).toBeNull();
  });

  it("cohorts by lines changed when estimates are absent", () => {
    const rows = [
      row({ lines_changed: 400 }),
      row({ lines_changed: 2000 }),
      row({ lines_changed: 5000 }),
      row({ lines_changed: 5500 }),
    ];
    const s = workTimelineStats(rows, [], 0);
    expect(s.sized_by).toBe("lines");
    expect(s.size_classes.map((c) => [c.size, c.tickets])).toEqual([
      ["S", 1],
      ["M", 1],
      ["L", 2],
    ]);
    expect(s.size_classes[0].bounds).toBe("<1k lines");
  });

  it("cohorts by Linear estimate when at least half the tickets carry one", () => {
    const rows = [
      row({ estimate: 1 }),
      row({ estimate: 5 }),
      row({ estimate: 8 }),
      row({ estimate: null, lines_changed: 50 }), // unsized in estimate mode
    ];
    const s = workTimelineStats(rows, [], 0);
    expect(s.sized_by).toBe("estimate");
    expect(s.size_classes.map((c) => [c.size, c.tickets])).toEqual([
      ["S", 1],
      ["M", 1],
      ["L", 1],
    ]);
    expect(s.size_classes[0].bounds).toBe("≤2 pts");
    // The unsized ticket still counts toward the phase stats.
    expect(s.tickets).toBe(4);
  });

  it("computes cohort total as the per-ticket pickup → merge median", () => {
    const rows = [
      row({ lines_changed: 100, started_at: h(2), last_merged: h(10) }), // 8h
      row({ lines_changed: 200, started_at: h(2), last_merged: h(14) }), // 12h
    ];
    const s = workTimelineStats(rows, [], 0);
    expect(s.size_classes[0].total_hours).toBe(10);
  });

  it("carries last week's per-cohort total and count for comparison", () => {
    const s = workTimelineStats(
      [row({ lines_changed: 100, last_merged: h(10) })], // S, 8h
      [
        row({ lines_changed: 200, last_merged: h(6) }), // S, 4h
        row({ lines_changed: 300, last_merged: h(8) }), // S, 6h
        row({ lines_changed: 2000 }), // M — last week only
      ],
      0,
    );
    const sClass = s.size_classes.find((c) => c.size === "S")!;
    expect(sClass.prev_tickets).toBe(2);
    expect(sClass.prev_total_hours).toBe(5);
    // A cohort with tickets only last week still shows, with zero this week.
    const mClass = s.size_classes.find((c) => c.size === "M")!;
    expect(mClass.tickets).toBe(0);
    expect(mClass.prev_tickets).toBe(1);
    expect(s.queue_median_hours_prev).toBe(2);
  });

  it("returns null stats for an empty week but keeps last week's cohorts visible", () => {
    const s = workTimelineStats([], [row()], 2);
    expect(s.tickets).toBe(0);
    expect(s.unjoined).toBe(2);
    expect(s.size_classes).toEqual([
      expect.objectContaining({ size: "S", tickets: 0, prev_tickets: 1 }),
    ]);
    expect(s.week.build.median_hours).toBeNull();
    expect(s.prev_week.build.median_hours).toBe(4);
  });
});

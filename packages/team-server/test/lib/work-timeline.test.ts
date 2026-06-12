import { describe, it, expect } from "vitest";
import { workTimelinePhases, type WorkTimelineRow } from "../../src/lib/team-report-aggregate.js";

const T0 = "2026-06-01T08:00:00Z";
const h = (hours: number) => new Date(Date.parse(T0) + hours * 3600_000).toISOString();

function row(patch: Partial<WorkTimelineRow> = {}): WorkTimelineRow {
  // Clean chain: 2h queue, 1h spin-up, 3h build, 4h merge wait, 0.5h resolution.
  return {
    created_at: h(0),
    started_at: h(2),
    first_commit: h(3),
    first_pr_created: h(6),
    last_merged: h(10),
    completed_at: h(10.5),
    ...patch,
  };
}

describe("workTimelinePhases", () => {
  it("decomposes a clean chain into per-phase hours", () => {
    expect(workTimelinePhases([row()])).toEqual({
      queue_hours: 2,
      spin_up_hours: 1,
      build_hours: 3,
      merge_wait_hours: 4,
      resolution_hours: 0.5,
    });
  });

  it("takes the median across tickets per phase", () => {
    const rows = [
      row(),
      row({ started_at: h(6) }), // 6h queue
      row({ started_at: h(10), first_commit: h(11), first_pr_created: h(14), last_merged: h(18), completed_at: h(18.5) }), // 10h queue
    ];
    expect(workTimelinePhases(rows).queue_hours).toBe(6);
  });

  it("clamps spin-up to 0 when the commit precedes the status flip", () => {
    const p = workTimelinePhases([row({ started_at: h(3.5) })]); // commit at h(3), picked up h(3.5)
    expect(p.spin_up_hours).toBe(0);
    expect(p.queue_hours).toBe(3.5);
  });

  it("clamps resolution to 0 when the ticket resolved before the merge", () => {
    const p = workTimelinePhases([row({ completed_at: h(8) })]); // merged h(10)
    expect(p.resolution_hours).toBe(0);
  });

  it("drops a ticket from phases whose boundary is missing, without zeroing others", () => {
    const p = workTimelinePhases([row({ started_at: null })]);
    expect(p.queue_hours).toBeNull();
    expect(p.spin_up_hours).toBeNull();
    expect(p.build_hours).toBe(3);
  });

  it("drops negative non-clamped phases instead of polluting the median", () => {
    // PR opened before its recorded first commit — bad data, not a real phase.
    const p = workTimelinePhases([row({ first_pr_created: h(2.5) })]);
    expect(p.build_hours).toBeNull();
  });

  it("returns all-null for an empty week", () => {
    expect(workTimelinePhases([])).toEqual({
      queue_hours: null,
      spin_up_hours: null,
      build_hours: null,
      merge_wait_hours: null,
      resolution_hours: null,
    });
  });
});

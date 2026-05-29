import { describe, it, expect } from "vitest";
import { buildMockGroupReport } from "../../src/lib/mock-group-report.js";

const members = [
  { membershipId: "00000000-0000-0000-0000-000000000001", name: "Ada", tier: "pro-max-20x" },
  { membershipId: "00000000-0000-0000-0000-000000000002", name: "Bo", tier: "pro-max-20x" },
  { membershipId: "00000000-0000-0000-0000-000000000003", name: "Cy", tier: "pro-max" },
];

describe("buildMockGroupReport", () => {
  it("synthesizes a report for the real roster with no DB", () => {
    const md = buildMockGroupReport(members);
    expect(md.membersTotal).toBe(3);
    // Distribution sums to the roster size and matches the portraits.
    const mix = md.report.live_extras!.maturity_mix;
    const sum = (Object.values(mix.distribution) as number[]).reduce((a, b) => a + b, 0);
    expect(sum).toBe(3);
    const names = md.report.live_extras!.member_portraits!.map((p) => p.member).sort();
    expect(names).toEqual(["Ada", "Bo", "Cy"]);
    // Header roster carries the real names.
    expect(md.report.cross_edition.roster.map((r) => r.display_name).sort()).toEqual(["Ada", "Bo", "Cy"]);
  });

  it("gives the multiplier an in-group adopter and excludes volume-only grading", () => {
    const md = buildMockGroupReport(members);
    const l4 = md.report.live_extras!.member_portraits!.find((p) => p.level === "L4")!;
    expect(l4).toBeTruthy();
    expect(l4.harness.cross_member_adopters_30d).toBeGreaterThanOrEqual(1);
    expect(l4.qualifying_paths).toContain("L4-coaches");
  });

  it("emits a 4-week trend and a downgrade candidate for an underused top-tier seat", () => {
    const md = buildMockGroupReport(members);
    expect(md.trend).toHaveLength(4);
    expect(md.trend[3].agentHours).toBeGreaterThanOrEqual(md.trend[0].agentHours);
    // At least one 20x non-author runs cool → a downgrade candidate.
    expect(md.seatCandidates.length).toBeGreaterThanOrEqual(1);
    expect(md.seatCandidates[0].toTier).toBe("Claude Pro Max");
    expect(md.seatCandidates[0].savingsUsd).toBe(100);
  });

  it("is deterministic across calls (stable refresh)", () => {
    const a = buildMockGroupReport(members);
    const b = buildMockGroupReport(members);
    expect(a.report.live_extras!.maturity_mix.distribution).toEqual(b.report.live_extras!.maturity_mix.distribution);
    expect(a.seatCandidates).toEqual(b.seatCandidates);
  });

  it("never downgrades a lowest-tier member", () => {
    const allPro = [
      { membershipId: "00000000-0000-0000-0000-0000000000a1", name: "P1", tier: "pro" },
      { membershipId: "00000000-0000-0000-0000-0000000000a2", name: "P2", tier: "pro" },
    ];
    const md = buildMockGroupReport(allPro);
    expect(md.seatCandidates).toHaveLength(0);
  });
});

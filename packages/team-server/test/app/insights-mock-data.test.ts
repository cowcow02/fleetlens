import { describe, it, expect } from "vitest";
import { mockTeamInsightReport } from "../../src/app/team/[slug]/insights/mock-data";

describe("mockTeamInsightReport", () => {
  it("has all surfaced sections populated with non-trivial content", () => {
    const r = mockTeamInsightReport;
    expect(r.week_monday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(r.pulse.agent_hours).toBeGreaterThan(0);
    expect(r.pulse.members_active).toBeLessThanOrEqual(r.pulse.members_total);
    expect(r.pulse.concurrency_peak.peak).toBeGreaterThan(0);

    expect(r.how_they_worked.goal_categories.length).toBeGreaterThanOrEqual(3);
    const goalSharePct = r.how_they_worked.goal_categories.reduce((s, g) => s + g.share_pct, 0);
    expect(goalSharePct).toBeGreaterThan(95);
    expect(goalSharePct).toBeLessThan(105);

    expect(r.harness.tool_families.length).toBeGreaterThanOrEqual(3);
    expect(r.harness.user_skills.length).toBeGreaterThanOrEqual(2);
    expect(r.harness.user_subagents.length).toBeGreaterThanOrEqual(1);

    expect(r.projects.length).toBeGreaterThanOrEqual(3);
    r.projects.forEach((p) => {
      expect(p.members.length).toBeGreaterThan(0);
    });

    // Spotlight unit is an opt-in SESSION — every spotlight must carry a
    // concrete session anchor (date + project + duration) and a
    // harness signature that names the actual skills/subagents used.
    const flavors = new Set(r.spotlights.map((s) => s.flavor));
    expect(flavors.has("case-study")).toBe(true);
    expect(flavors.has("strength-surfacing")).toBe(true);
    r.spotlights.forEach((s) => {
      expect(s.body.length).toBeGreaterThan(200);
      expect(s.session_meta.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.session_meta.project.length).toBeGreaterThan(0);
      expect(s.session_meta.duration_hours).toBeGreaterThan(0);
      expect(s.harness_signature.length).toBeGreaterThan(20);
    });

    expect(r.roster.length).toBe(r.pulse.members_active);
  });
});

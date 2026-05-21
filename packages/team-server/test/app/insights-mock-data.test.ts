import { describe, it, expect } from "vitest";
import { mockTeamInsightReport } from "../../src/lib/insights-mock-data";

describe("mockTeamInsightReport (maximal prototype)", () => {
  it("populates all 30 sections (A–DD) with non-trivial content", () => {
    const r = mockTeamInsightReport;
    expect(r.week_monday).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // A. Volume
    expect(r.volume.agent_hours_total).toBeGreaterThan(0);
    expect(r.volume.agent_hours_per_member.length).toBeGreaterThan(0);
    expect(r.volume.session_length_histogram.length).toBeGreaterThan(0);

    // B. Code zones
    expect(r.code_zones.file_heatmap.length).toBeGreaterThan(0);
    expect(r.code_zones.cold_directories.length).toBeGreaterThan(0);

    // C. Working style
    expect(r.working_style.prompt_length_distribution_per_member.length).toBeGreaterThan(0);
    expect(r.working_style.sentiment_user_messages_per_member.length).toBeGreaterThan(0);

    // D. Tool usage
    expect(r.tool_usage.bash_subverb_heatmap.length).toBeGreaterThan(0);

    // E. Skills & harness
    expect(r.skills_harness.user_authored_skills.length).toBeGreaterThan(0);
    expect(r.skills_harness.skill_diffusion_events.length).toBeGreaterThan(0);

    // F. Delegation
    expect(r.delegation.subagent_dispatches_per_member.length).toBeGreaterThan(0);

    // G. Plan mode
    expect(r.plan_mode.adopters).toBeGreaterThan(0);

    // H. Outcomes
    expect(r.outcomes.prs_shipped).toBeGreaterThan(0);

    // I. Friction
    expect(r.friction.cooccurring_friction.length).toBeGreaterThan(0);

    // J. Diffusion
    expect(r.diffusion.skill_pickups.length).toBeGreaterThan(0);
    expect(r.diffusion.skill_family_curve[0].weekly.length).toBeGreaterThan(0);

    // K. Co-occurrence
    expect(r.cooccurrence.shared_files_same_week.length).toBeGreaterThan(0);

    // L. Bench
    expect(r.bench.task_category_bench.length).toBeGreaterThan(0);

    // M. Novelty
    expect(r.novelty.weeks_invention.headline.length).toBeGreaterThan(0);

    // N. External systems
    expect(r.external_systems.linear_refs.length).toBeGreaterThan(0);

    // O. Prompting fingerprint
    expect(r.prompting_fingerprint.style_per_member.length).toBeGreaterThan(0);

    // P. Rhythm
    expect(r.rhythm.team_hour_histogram.length).toBe(24);

    // Q. Velocity
    expect(r.velocity.sessions_per_day.length).toBeGreaterThan(0);

    // R. Knowledge flow
    expect(r.knowledge_flow.pattern_a_to_b.length).toBeGreaterThan(0);

    // S. AI behavior
    expect(r.ai_behavior.model_usage.length).toBeGreaterThan(0);

    // T. Cost
    expect(r.cost_efficiency.cost_per_pr_per_project.length).toBeGreaterThan(0);

    // U. Coverage
    expect(r.coverage.untouched_files_count).toBeGreaterThan(0);

    // V. Trend
    expect(r.trend.maturity_composite_weekly.length).toBeGreaterThan(0);

    // W. Onboarding
    expect(r.onboarding.ramp_up_curves.length).toBeGreaterThan(0);

    // X. Manager
    expect(r.manager.wins_this_week.length).toBeGreaterThan(0);

    // Y. Org rollup
    expect(r.org_rollup.team_vs_org_comparison.length).toBeGreaterThan(0);

    // Z. Pair work
    expect(r.pair_work.multiday_continuations.length).toBeGreaterThan(0);

    // AA. Outliers
    expect(r.outliers.atypical_day_per_member.length).toBeGreaterThan(0);

    // BB. Spotlights
    expect(r.spotlights.length).toBeGreaterThanOrEqual(3);
    r.spotlights.forEach((s) => {
      expect(s.body.length).toBeGreaterThan(100);
      expect(s.session_meta.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    // CC. Meta
    expect(r.meta.section_coverage.length).toBe(30);
    expect(r.meta.section_coverage.every((s) => s.populated)).toBe(true);

    // DD. Cross-edition
    expect(r.cross_edition.roster.length).toBeGreaterThan(0);
  });

  it("populates v6 ticket-flow data with coherent phase journeys", () => {
    const v6 = mockTeamInsightReport.variants.v6_extras;
    expect(v6.phase_summaries.map((p) => p.phase)).toEqual([
      "spec",
      "ready",
      "implementation",
      "code-review",
      "qa",
      "launch",
    ]);
    expect(v6.workflow_mappings.length).toBeGreaterThanOrEqual(6);
    expect(v6.ticket_journeys.length).toBeGreaterThanOrEqual(3);

    for (const ticket of v6.ticket_journeys) {
      const summed = ticket.phase_spans.reduce((sum, span) => sum + span.duration_min, 0);
      expect(summed).toBe(ticket.total_min);
      expect(ticket.phase_spans.some((span) => span.submitted_sections.length > 0)).toBe(true);
    }

    expect(v6.implementation_trend.at(-1)?.median_implementation_min).toBeLessThan(
      v6.implementation_trend[0].median_implementation_min,
    );
    expect(v6.case_studies.some((c) => c.evidence_level === "opt-in-session")).toBe(true);
  });
});

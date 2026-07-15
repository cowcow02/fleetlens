"use client";

import type { TeamInsightReport } from "../app/team/[slug]/insights/types";
import type { MomentumTrendWeek } from "../lib/insights-aggregate";
import { provenanceFor } from "../lib/metric-provenance";
import { ExplainBadge } from "./explain-badge";
import { BLOCK_CATALOG, defaultWidthFor } from "./insights-variants/v7-builder-blocks";

// Per-group momentum dashboard — a focused, read-only rendering of the same
// live blocks the team report uses (BLOCK_CATALOG), but curated into the three
// framework questions and aggregate-first. No builder chrome, no localStorage,
// no team-wide PDF button — the group page owns its own group-scoped export.
//
// Per-member portraits and metric provenance notes always render; the page
// itself is only reachable by admin/staff or the group's manager.

type Section = { key: string; heading: string; framing: string; blockIds: string[] };

function blockById(id: string) {
  return BLOCK_CATALOG.find((b) => b.id === id) ?? null;
}

function TrendCard({
  label,
  values,
  unit = "",
  fmt,
  explainId,
}: {
  label: string;
  values: number[];
  unit?: string;
  fmt: (v: number) => string;
  explainId?: string;
}) {
  const max = Math.max(...values, 1);
  const latest = values[values.length - 1] ?? 0;
  const delta = latest - (values[0] ?? 0);
  const dir = delta > 0.05 ? "▲" : delta < -0.05 ? "▼" : "→";
  const tone = delta > 0.05 ? "var(--positive)" : delta < -0.05 ? "var(--accent)" : "var(--ink-soft)";
  return (
    <div className="builder-widget" style={{ gridColumn: "span 1" }}>
      <header className="builder-widget-head">
        <div className="builder-widget-titlewrap">
          <h3 className="builder-widget-title">
            {label}
            {explainId && <ExplainBadge p={provenanceFor(explainId)} />}
          </h3>
        </div>
      </header>
      <div className="builder-widget-body">
        <div style={{ fontSize: 30, fontFamily: "var(--serif, Georgia, serif)", lineHeight: 1 }}>
          {fmt(latest)}
          {unit}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 40, margin: "12px 0 8px" }}>
          {values.map((v, i) => (
            <div
              key={i}
              title={`${fmt(v)}${unit}`}
              style={{
                flex: 1,
                height: `${Math.max(3, (v / max) * 100)}%`,
                background: i === values.length - 1 ? "var(--accent)" : "var(--rule)",
                borderRadius: "2px 2px 0 0",
              }}
            />
          ))}
        </div>
        <div className="kicker" style={{ color: tone }}>
          {dir} {fmt(Math.abs(delta))}{unit} over {values.length} wks
        </div>
      </div>
    </div>
  );
}

export function GroupMomentumReport({
  report,
  trend,
}: {
  report: TeamInsightReport;
  trend?: MomentumTrendWeek[];
}) {
  const sections: Section[] = [
    {
      key: "using",
      heading: "Using it",
      framing:
        "Adoption — who in the group is active, and how much agent time the group is putting in.",
      blockIds: ["live-active-rate", "team-pulse-wow"],
    },
    {
      key: "better",
      heading: "Getting better",
      framing:
        "Adoption maturity on the L0–L4 ladder, read on three axes — shared leverage " +
        "(authored skills / sub-agents / CLAUDE.md that teammates adopt), autonomy " +
        "(less steering: plan-mode, long autonomous runs), and outcome velocity (work that ships). " +
        "Grading is observable-action driven and deliberately excludes raw session/token volume.",
      blockIds: ["live-maturity-mix", "live-member-portraits", "live-plan-mode", "long-autonomous-texture", "skill-usage-wow-bars"],
    },
    {
      key: "shipping",
      heading: "Changing how we ship",
      framing:
        report.live_extras?.github_delivery || report.live_extras?.linear_velocity || report.live_extras?.jira_velocity
          ? "Impact — delivery confirmed by this group's connected sources (" +
            [
              report.live_extras?.github_delivery && "GitHub merges",
              report.live_extras?.linear_velocity && "Linear tickets",
              report.live_extras?.jira_velocity && "Jira tickets",
            ]
              .filter(Boolean)
              .join(", ") +
            "), alongside transcript-side PR throughput and where the effort landed."
          : "Impact proxy — PR throughput and where the effort landed. Correlation, not causation: " +
            "agent adoption is one input among many, not a measured cause of delivery.",
      blockIds: [
        ...(report.live_extras?.work_timeline ? ["work-timeline"] : []),
        ...(report.live_extras?.github_delivery ? ["github-delivery"] : []),
        ...(report.live_extras?.linear_velocity ? ["linear-velocity"] : []),
        ...(report.live_extras?.jira_velocity ? ["jira-velocity"] : []),
        "live-prs-shipped",
        // Repo-time breakdown only renders when GitHub resolution produced
        // rows — without it the block would just echo local directory names.
        ...(report.variants.wow_pulse.project_time.some((p) => p.repo && p.hours_this_week > 0)
          ? ["per-project-time-bars"]
          : []),
      ],
    },
  ];

  return (
    <div className="group-momentum">
      <div className="explain-banner">
        Every metric below is computed from members&rsquo; pushed rollups.{" "}
        Hover any &#9432; for its data source, pipeline status, and whether it&rsquo;s deterministic or LLM-generated.
      </div>
      {trend && trend.length > 0 && (
        <section className="live-section" style={{ marginTop: 28 }}>
          <div className="subsection-head">
            <h2>
              <em>Momentum · last {trend.length} weeks</em>
              <ExplainBadge p={provenanceFor("momentum-trend")} />
            </h2>
          </div>
          <p className="kicker" style={{ marginTop: 4, marginBottom: 14, maxWidth: 760, lineHeight: 1.5 }}>
            Four-week trajectory, oldest → newest — the primary read for a small group, where
            single week-over-week swings are noisy. The per-tile &ldquo;vs last wk&rdquo; figures below
            are secondary context.
          </p>
          <div className="builder-grid group-momentum-grid">
            <TrendCard label="Agent time" unit="h" values={trend.map((t) => t.agentHours)} fmt={(v) => v.toFixed(1)} explainId="trend-agent-time" />
            <TrendCard label="Active members" values={trend.map((t) => t.activeMembers)} fmt={(v) => String(Math.round(v))} explainId="trend-active-members" />
            <TrendCard label="PRs shipped" values={trend.map((t) => t.prs)} fmt={(v) => String(Math.round(v))} explainId="trend-prs" />
            <TrendCard label="Sessions" values={trend.map((t) => t.sessions)} fmt={(v) => String(Math.round(v))} explainId="trend-sessions" />
          </div>
        </section>
      )}
      {sections.map((s) => (
        <section key={s.key} className="live-section" style={{ marginTop: 28 }}>
          <div className="subsection-head">
            <h2>
              <em>{s.heading}</em>
            </h2>
          </div>
          <p className="kicker" style={{ marginTop: 4, marginBottom: 14, maxWidth: 760, lineHeight: 1.5 }}>
            {s.framing}
          </p>
          <div className="builder-grid group-momentum-grid">
            {s.blockIds.map((id) => {
              const block = blockById(id);
              if (!block) return null;
              return (
                <div
                  key={id}
                  className="builder-widget"
                  style={{ gridColumn: `span ${defaultWidthFor(block)}` }}
                >
                  <header className="builder-widget-head">
                    <div className="builder-widget-titlewrap">
                      <h3 className="builder-widget-title">
                        {block.title}
                        <ExplainBadge p={provenanceFor(id)} />
                      </h3>
                    </div>
                  </header>
                  <div className="builder-widget-body">{block.render(report)}</div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

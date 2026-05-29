"use client";

import type { TeamInsightReport } from "../app/team/[slug]/insights/types";
import { BLOCK_CATALOG, defaultWidthFor } from "./insights-variants/v7-builder-blocks";

// Per-group momentum dashboard — a focused, read-only rendering of the same
// live blocks the team report uses (BLOCK_CATALOG), but curated into the three
// framework questions and aggregate-first. No builder chrome, no localStorage,
// no team-wide PDF button — the group page owns its own group-scoped export.
//
// The per-member portraits (the deep coaching detail) are only rendered when
// `coaching` is true. The caller is responsible for stripping
// report.live_extras.member_portraits when coaching is off, so that data never
// reaches the client in the default aggregate view.

type Section = { key: string; heading: string; framing: string; blockIds: string[] };

function blockById(id: string) {
  return BLOCK_CATALOG.find((b) => b.id === id) ?? null;
}

export function GroupMomentumReport({
  report,
  coaching,
}: {
  report: TeamInsightReport;
  coaching: boolean;
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
      blockIds: coaching
        ? ["live-maturity-mix", "live-member-portraits", "live-plan-mode", "long-autonomous-texture", "skill-usage-wow-bars"]
        : ["live-maturity-mix", "live-plan-mode", "long-autonomous-texture", "skill-usage-wow-bars"],
    },
    {
      key: "shipping",
      heading: "Changing how we ship",
      framing:
        "Impact proxy — PR throughput and where the effort landed. Correlation, not causation: " +
        "agent adoption is one input among many, not a measured cause of delivery.",
      blockIds: ["live-prs-shipped", "per-project-time-bars"],
    },
  ];

  return (
    <div className="group-momentum">
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
                      <h3 className="builder-widget-title">{block.title}</h3>
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

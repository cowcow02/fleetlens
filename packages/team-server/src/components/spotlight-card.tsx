import type { Spotlight, SpotlightFlavor } from "../app/team/[slug]/insights/types";

const FLAVOR_LABEL: Record<SpotlightFlavor, string> = {
  "cross-team-pattern": "Cross-team pattern",
  "case-study": "Case study",
  "strength-surfacing": "Strength surfacing",
};

export function SpotlightCard({ spotlight }: { spotlight: Spotlight }) {
  const paragraphs = spotlight.body.split("\n\n");
  return (
    <article className={`spotlight-card flavor-${spotlight.flavor}`}>
      <div className="spotlight-card-meta">
        <span className={`spotlight-flavor-badge flavor-${spotlight.flavor}`}>
          {FLAVOR_LABEL[spotlight.flavor]}
        </span>
        <span>From {spotlight.author}</span>
      </div>
      <h3 className="spotlight-title">{spotlight.title}</h3>
      <div className="spotlight-body">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <div className="spotlight-evidence">{spotlight.evidence}</div>
    </article>
  );
}

export function SpotlightsSection({ spotlights }: { spotlights: Spotlight[] }) {
  return (
    <section className="insights-section">
      <div className="subsection-head">
        <h2>Spot<em>lights</em></h2>
        <div className="kicker">Member-submitted, opt-in · this week&apos;s signal</div>
      </div>

      {spotlights.length === 0 ? (
        <div className="insights-spotlight-empty">
          No spotlights this week. Members can publish sections from their personal Fleetlens at <code>/team-share</code> to add cross-team patterns, individual case studies, or strength surfacings to this report.
        </div>
      ) : (
        <div className="spotlight-stack">
          {spotlights.map((s) => (
            <SpotlightCard key={s.id} spotlight={s} />
          ))}
        </div>
      )}
    </section>
  );
}

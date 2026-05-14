import type { Spotlight, SpotlightFlavor } from "../app/team/[slug]/insights/types";

const FLAVOR_LABEL: Record<SpotlightFlavor, string> = {
  "case-study": "Case study",
  "strength-surfacing": "Strength surfacing",
};

function shippedLabel(n: number): string {
  if (n === 0) return "no PRs shipped";
  return `shipped ${n} PR${n === 1 ? "" : "s"}`;
}

export function SpotlightCard({ spotlight }: { spotlight: Spotlight }) {
  const paragraphs = spotlight.body.split("\n\n");
  const meta = spotlight.session_meta;
  return (
    <article className={`spotlight-card flavor-${spotlight.flavor}`}>
      <div className="spotlight-card-meta">
        <span className={`spotlight-flavor-badge flavor-${spotlight.flavor}`}>
          {FLAVOR_LABEL[spotlight.flavor]}
        </span>
        <span>From {spotlight.author}</span>
      </div>
      <h3 className="spotlight-title">{spotlight.title}</h3>
      <div className="spotlight-session-meta">
        Session · {meta.date} · {meta.project} · {meta.duration_hours.toFixed(1)}h · {shippedLabel(meta.shipped)}
      </div>
      <div className="spotlight-body">
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <div className="spotlight-evidence">{spotlight.harness_signature}</div>
    </article>
  );
}

export function SpotlightsSection({ spotlights }: { spotlights: Spotlight[] }) {
  return (
    <section className="insights-section">
      <div className="subsection-head">
        <h2>Spot<em>lights</em></h2>
        <div className="kicker">Member-submitted sessions · concrete agent walkthroughs</div>
      </div>

      {spotlights.length === 0 ? (
        <div className="insights-spotlight-empty">
          No spotlights this week. Members can opt-in specific sessions from their personal Fleetlens at <code>/team-share</code> — the team-side synthesizer turns each shared session into a concrete walkthrough card for this report.
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

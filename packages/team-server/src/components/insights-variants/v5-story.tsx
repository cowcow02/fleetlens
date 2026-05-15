import type { TeamInsightReport } from "../../app/team/[slug]/insights/types";

export function VariantStory({ r }: { r: TeamInsightReport }) {
  return (
    <div className="variant-frame">
      <div className="variant-intro">
        <strong>v5 · Story-only.</strong> No tables, no fact tiles, no sparklines. Eight paragraphs that
        read like a magazine column — what changed this week in how members collaborate with the agent,
        anchored to specific people, specific sessions, specific dates. The radical end of the
        "fewer aggregates, more narrative" axis.
      </div>

      <article className="story-article">
        {r.variants.story_paragraphs.map((p, i) => (
          <section key={i} className="story-section">
            {p.heading && <h3 className="story-heading">{p.heading}</h3>}
            <p className="story-body">{p.body}</p>
          </section>
        ))}
      </article>
    </div>
  );
}

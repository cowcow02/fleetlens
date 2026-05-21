import type { TeamInsightReport } from "../../app/team/[slug]/insights/types";

// First paragraph opens the report — the editorial hero.
export function StoryHero({ r }: { r: TeamInsightReport }) {
  const first = r.variants.story_paragraphs[0];
  if (!first) return null;
  return (
    <article className="story-hero">
      {first.heading && <h2 className="story-hero-heading">{first.heading}</h2>}
      <p className="story-hero-body">{first.body}</p>
    </article>
  );
}

// Final 3 paragraphs close the report — team-level synthesis + 1:1 prompts.
export function StoryClosing({ r }: { r: TeamInsightReport }) {
  // Skip the member-specific paragraphs (1-4) since the fingerprints section
  // already covers per-member story; take only the team-level + manager prose
  // from the tail of the array.
  const closing = r.variants.story_paragraphs.slice(-3);
  return (
    <article className="story-article">
      {closing.map((p, i) => (
        <section key={i} className="story-section">
          {p.heading && <h3 className="story-heading">{p.heading}</h3>}
          <p className="story-body">{p.body}</p>
        </section>
      ))}
    </article>
  );
}

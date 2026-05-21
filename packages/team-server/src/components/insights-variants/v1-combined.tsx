import type { TeamInsightReport } from "../../app/team/[slug]/insights/types";
import { FingerprintsSection } from "./v1-fingerprints";
import { TrajectoriesSection } from "./v2-trajectories";
import { DiffusionSection } from "./v3-diffusion";
import { ArchetypesSection } from "./v4-archetypes";
import { StoryHero, StoryClosing } from "./v5-story";

export function VariantCombined({ r }: { r: TeamInsightReport }) {
  return (
    <div className="variant-frame">
      <StoryHero r={r} />

      <section className="combined-section">
        <header className="combined-section-head">
          <h2><em>Member</em> fingerprints</h2>
          <div className="kicker">How each person collaborates with the agent · 4-week growth arc</div>
        </header>
        <FingerprintsSection r={r} />
      </section>

      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Growth <em>trajectories</em></h2>
          <div className="kicker">Practice × member · the same data as fingerprints, told as a matrix</div>
        </header>
        <TrajectoriesSection r={r} />
      </section>

      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Practice <em>diffusion</em></h2>
          <div className="kicker">Who's adopted what · how moves spread across the team</div>
        </header>
        <DiffusionSection r={r} />
      </section>

      <section className="combined-section">
        <header className="combined-section-head">
          <h2>Session <em>archetypes</em></h2>
          <div className="kicker">Six recurring session shapes · per-member mix · illustrative timelines</div>
        </header>
        <ArchetypesSection r={r} />
      </section>

      <section className="combined-section combined-closing">
        <header className="combined-section-head">
          <h2>Closing <em>reflections</em></h2>
          <div className="kicker">Team-level synthesis · what to ask in this week's 1:1s</div>
        </header>
        <StoryClosing r={r} />
      </section>
    </div>
  );
}

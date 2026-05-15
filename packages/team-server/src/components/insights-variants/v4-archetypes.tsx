import type { TeamInsightReport } from "../../app/team/[slug]/insights/types";

const TURN_CLASS: Record<string, string> = {
  user: "turn-user",
  agent: "turn-agent",
  tool: "turn-tool",
  subagent: "turn-subagent",
};

export function ArchetypesSection({ r }: { r: TeamInsightReport }) {
  const archetypes = r.variants.session_archetypes;
  const distribution = r.variants.archetype_distribution;
  const timelines = r.variants.illustrative_session_timelines;

  return (
    <>
      <section style={{ marginTop: 0 }}>
        <h3 className="variant-subhead">The six archetypes</h3>
        <div className="archetype-card-grid">
          {archetypes.map((a) => (
            <div key={a.key} className="archetype-card">
              <div className="archetype-card-name">{a.name}</div>
              <div className="archetype-card-signature">{a.illustrative_signature}</div>
              <div className="archetype-card-desc">{a.description}</div>
              <div className="archetype-card-cue">
                <strong>Cue:</strong> {a.cue}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 30 }}>
        <h3 className="variant-subhead">Each member's archetype mix</h3>
        <div className="archetype-mix-grid">
          {distribution.map((row) => (
            <div key={row.member} className="archetype-mix-row">
              <div className="archetype-mix-member">{row.member}</div>
              <div className="archetype-mix-bar">
                {row.distribution.map((d, i) => {
                  if (d.pct === 0) return null;
                  const arch = archetypes.find((a) => a.key === d.archetype_key);
                  return (
                    <div
                      key={d.archetype_key}
                      className={`archetype-mix-seg archetype-color-${i}`}
                      style={{ width: `${d.pct}%` }}
                      title={`${arch?.name ?? d.archetype_key}: ${d.pct}%`}
                    >
                      {d.pct >= 10 ? `${d.pct}%` : ""}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="archetype-mix-legend">
            {archetypes.map((a, i) => (
              <span key={a.key}>
                <span className={`archetype-mix-swatch archetype-color-${i}`} />
                {a.name}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section style={{ marginTop: 30 }}>
        <h3 className="variant-subhead">Illustrative session timelines</h3>
        <p className="variant-helper">Each row is one session, turn-by-turn. The shape tells the story the aggregate stat can't.</p>
        {timelines.map((t) => {
          const arch = archetypes.find((a) => a.key === t.archetype_key);
          const totalWeight = t.turns.reduce((s, x) => s + x.weight, 0);
          return (
            <div key={t.session_label} className="timeline-card">
              <div className="timeline-head">
                <strong>{t.session_label}</strong>
                <span className="timeline-arch-tag">{arch?.name ?? t.archetype_key}</span>
              </div>
              <div className="timeline-bar">
                {t.turns.map((turn, i) => (
                  <div
                    key={i}
                    className={`timeline-turn ${TURN_CLASS[turn.kind]}`}
                    style={{ width: `${(turn.weight / totalWeight) * 100}%` }}
                    title={`${turn.kind}: ${turn.tag ?? ""}`}
                  >
                    <span className="timeline-turn-tag">{turn.tag}</span>
                  </div>
                ))}
              </div>
              <div className="timeline-legend">
                <span><span className="timeline-swatch turn-user" /> user msg</span>
                <span><span className="timeline-swatch turn-tool" /> tool / skill</span>
                <span><span className="timeline-swatch turn-subagent" /> subagent dispatch</span>
                <span><span className="timeline-swatch turn-agent" /> agent prose</span>
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}

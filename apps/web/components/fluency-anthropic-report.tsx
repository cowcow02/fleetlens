/**
 * Renderer for the strict-Anthropic AnthropicScorecard.
 * Visual style mirrors the documented scorecard shape: surfaces line,
 * 80–110 word summary, per-axis rows with rating glyph + verbatim
 * quotes attributed by surface, and a separate Insights block.
 */

import { Fluency } from "@claude-lens/entries";
type AnthropicScorecard = Fluency.AnthropicScorecard;
type AnthropicAxisId = Fluency.AnthropicAxisId;
type AnthropicAxisObservation = Fluency.AnthropicAxisObservation;
type AnthropicPillar = Fluency.AnthropicPillar;
type FluencyRating = Fluency.FluencyRating;
const ANTHROPIC_AXES = Fluency.ANTHROPIC_AXES;
const ANTHROPIC_AXIS_BY_ID = Fluency.ANTHROPIC_AXIS_BY_ID;
const ANTHROPIC_PILLAR_LABEL = Fluency.ANTHROPIC_PILLAR_LABEL;

const PILLAR_ORDER: AnthropicPillar[] = ["delegation", "description", "discernment"];

function glyph(r: FluencyRating): string {
  return r === "+" ? "[+]" : r === "~" ? "[~]" : r === "-" ? "[-]" : "[·]";
}
function ratingLabel(r: FluencyRating): string {
  return r === "+" ? "Demonstrated" : r === "~" ? "Partial" : r === "-" ? "Not observed" : "N/A";
}
function ratingTone(r: FluencyRating): string {
  return r === "+" ? "var(--af-success)" :
         r === "~" ? "var(--af-warning)" :
         r === "-" ? "var(--af-danger)" :
         "var(--af-text-tertiary)";
}

export function AnthropicHeadline({ card }: { card: AnthropicScorecard }) {
  return (
    <header
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: 24,
        alignItems: "start",
        padding: "20px 0 24px",
        borderBottom: "1px solid var(--af-border-subtle)",
      }}
      className="flu-headline"
    >
      <div>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.18em",
            color: "var(--af-text-tertiary)",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          AI Fluency Scorecard · Anthropic-style · 30-day window ending {card.window_end}
        </div>
        <h1
          style={{
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: 0,
            lineHeight: 1.2,
            fontSize: 26,
          }}
        >
          {card.member_name}&apos;s AI Fluency
        </h1>
        <p
          className="flu-headline-summary"
          style={{
            margin: "12px 0 0",
            fontSize: 14,
            lineHeight: 1.7,
            color: "var(--af-text-secondary)",
            maxWidth: 740,
          }}
        >
          {card.summary}
        </p>
      </div>
      <div className="flu-score">
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--af-text-tertiary)",
          }}
        >
          Fluency
        </div>
        <div
          className="flu-score-value"
          style={{
            fontSize: 38,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "var(--af-accent)",
            lineHeight: 1.1,
            margin: "6px 0 2px",
          }}
        >
          {card.score.numerator.toFixed(1)} / {card.score.denominator}
        </div>
        <div style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>
          {card.window_summary.sessions_total} sessions · {card.surfaces.cc} [cc]
          {card.surfaces.chat > 0 && ` · ${card.surfaces.chat} [chat]`}
          {card.surfaces.cowork > 0 && ` · ${card.surfaces.cowork} [cowork]`}
        </div>
      </div>
    </header>
  );
}

export function AnthropicScorecardGrid({ card }: { card: AnthropicScorecard }) {
  const byAxis = new Map<AnthropicAxisId, AnthropicAxisObservation>();
  for (const o of card.observations) byAxis.set(o.axis, o);
  return (
    <section style={{ marginTop: 22 }}>
      {PILLAR_ORDER.map((pillar) => {
        const axes = ANTHROPIC_AXES.filter((a) => a.pillar === pillar);
        return (
          <div key={pillar} style={{ marginBottom: 22 }}>
            <div
              className="flu-pillar-head"
              style={{
                fontSize: 12,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.16em",
                color: "var(--af-text-secondary)",
                marginBottom: 8,
              }}
            >
              {ANTHROPIC_PILLAR_LABEL[pillar]}
            </div>
            {axes.map((axis) => {
              const obs = byAxis.get(axis.id);
              if (!obs) return null;
              return (
                <article
                  key={axis.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "60px 1fr",
                    gap: 12,
                    alignItems: "start",
                    padding: "10px 0 12px",
                    borderBottom: "1px dashed var(--af-border-subtle)",
                  }}
                  className="flu-anth-row"
                >
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                      color: ratingTone(obs.rating),
                      fontWeight: 600,
                    }}
                    title={ratingLabel(obs.rating)}
                  >
                    {glyph(obs.rating)}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>
                      {axis.title}
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 12,
                          fontWeight: 400,
                          color: "var(--af-text-secondary)",
                        }}
                      >
                        — {axis.blurb}
                      </span>
                    </div>
                    {obs.evidence.length > 0 && (
                      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                        {obs.evidence.map((e, i) => (
                          <blockquote
                            key={i}
                            style={{
                              margin: 0,
                              padding: "6px 10px",
                              background: "var(--background)",
                              borderLeft: "2px solid var(--af-accent)",
                              borderRadius: 4,
                              fontSize: 12.5,
                              lineHeight: 1.5,
                            }}
                          >
                            &ldquo;{e.quote}&rdquo;
                            <div
                              style={{
                                marginTop: 4,
                                fontSize: 10,
                                color: "var(--af-text-tertiary)",
                                fontFamily: "var(--font-mono)",
                              }}
                            >
                              [{e.surface}] · {e.date} · {e.session_id.slice(0, 8)}
                            </div>
                          </blockquote>
                        ))}
                      </div>
                    )}
                    {obs.evidence.length === 0 && obs.rating === "-" && (
                      <div style={{ marginTop: 6, fontSize: 12, color: "var(--af-text-tertiary)", fontStyle: "italic" }}>
                        No evidence in the last 30 days.
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}

export function AnthropicInsights({ card }: { card: AnthropicScorecard }) {
  const ins = card.insights;
  if (!ins) return null;
  return (
    <section
      style={{
        marginTop: 24,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 14,
      }}
      className="flu-growth-grid"
    >
      <div
        style={{
          background: "var(--af-success-subtle)",
          border: "1px solid var(--af-success)",
          borderRadius: 10,
          padding: "14px 16px",
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--af-success)",
            fontWeight: 700,
          }}
        >
          Strength
        </div>
        <h3 style={{ margin: "6px 0 6px", fontSize: 16, fontWeight: 600 }}>{ins.strength_title}</h3>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>{ins.strength_body}</p>
      </div>
      <div
        style={{
          background: "var(--af-warning-subtle)",
          border: "1px solid var(--af-warning)",
          borderRadius: 10,
          padding: "14px 16px",
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--af-warning)",
            fontWeight: 700,
          }}
        >
          Try next
        </div>
        <h3 style={{ margin: "6px 0 6px", fontSize: 16, fontWeight: 600 }}>{ins.try_next_title}</h3>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>{ins.try_next_body}</p>
      </div>
    </section>
  );
}

export function AnthropicFeatureUsage({ card }: { card: AnthropicScorecard }) {
  const bucketed = {
    frequent: card.features.filter((f) => f.bucket === "frequent"),
    sometimes: card.features.filter((f) => f.bucket === "sometimes"),
    never: card.features.filter((f) => f.bucket === "never"),
  };
  return (
    <section
      style={{
        marginTop: 24,
        padding: "14px 16px",
        background: "var(--af-surface)",
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 10,
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--af-text-tertiary)",
          marginBottom: 8,
        }}
      >
        Claude Code feature usage · last 30 days
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", rowGap: 8, columnGap: 12, fontSize: 12 }}>
        <div style={{ color: "var(--af-success)", fontWeight: 600 }}>Frequent</div>
        <div>{bucketed.frequent.length ? bucketed.frequent.map((f) => `${f.feature}×${f.count_30d}`).join(", ") : <em style={{ color: "var(--af-text-tertiary)" }}>none</em>}</div>
        <div style={{ color: "var(--af-warning)", fontWeight: 600 }}>Sometimes</div>
        <div>{bucketed.sometimes.length ? bucketed.sometimes.map((f) => `${f.feature}×${f.count_30d}`).join(", ") : <em style={{ color: "var(--af-text-tertiary)" }}>none</em>}</div>
        <div style={{ color: "var(--af-text-tertiary)", fontWeight: 600 }}>Never used</div>
        <div style={{ color: "var(--af-text-tertiary)" }}>{bucketed.never.length ? bucketed.never.map((f) => f.feature).join(", ") : "—"}</div>
      </div>
    </section>
  );
}

export function AnthropicFooter({ card }: { card: AnthropicScorecard }) {
  return (
    <footer
      style={{
        marginTop: 24,
        paddingTop: 16,
        borderTop: "1px solid var(--af-border-subtle)",
        fontSize: 11,
        color: "var(--af-text-tertiary)",
        lineHeight: 1.7,
        maxWidth: 720,
      }}
    >
      Built on the public 4D AI Fluency Framework
      {" "}
      (<a href="https://aifluencyframework.org/" target="_blank" rel="noreferrer">CC BY-NC-SA</a>),
      following the Anthropic scorecard&apos;s documented shape — 11 indicators across Delegation,
      Description, and Discernment; 30-day rolling window; one verbatim evidence quote per axis;
      LLM-written 80–110 word summary. Per-axis ratings here are deterministic regex/count rules
      over Fleetlens Entry data; the Summary + Insights prose is model-generated.
      {card.llm?.model && (
        <> Model: <code>{card.llm.model}</code>{card.llm.cost_usd !== null && ` (~$${card.llm.cost_usd.toFixed(4)})`}.</>
      )}
    </footer>
  );
}

import type {
  FluencyAxisId,
  FluencyAxisMeta,
  FluencyAxisObservation,
  FluencyEvidence,
  FluencyPillar,
  FluencyRating,
  FluencyScorecard,
  RiskTrianglePosition,
  AgentSourceKey,
} from "@claude-lens/entries/fluency";
import {
  AGENT_SOURCE_LABEL,
  FLUENCY_AXES,
  FLUENCY_AXIS_BY_ID,
  PILLAR_BLURB,
  PILLAR_LABEL,
} from "@claude-lens/entries/fluency";
import { buildEvidenceHash } from "@/lib/evidence-link";

const PILLAR_ORDER: FluencyPillar[] = ["delegation", "description", "discernment"];

function ratingGlyph(rating: FluencyRating): string {
  switch (rating) {
    case "+": return "●";
    case "~": return "◐";
    case "-": return "○";
    default:  return "·";
  }
}

function ratingLabel(rating: FluencyRating): string {
  switch (rating) {
    case "+": return "Demonstrated";
    case "~": return "Partial";
    case "-": return "Not observed";
    default:  return "N/A";
  }
}

function ratingTone(rating: FluencyRating): string {
  switch (rating) {
    case "+": return "var(--af-success)";
    case "~": return "var(--af-warning)";
    case "-": return "var(--af-danger)";
    default:  return "var(--af-text-tertiary)";
  }
}

function fmtPct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function fmtScore(num: number, denom: number): string {
  const value = denom === 0 ? 0 : num;
  return `${value.toFixed(1)} / ${denom}`;
}

/* ------------------------------------------------------------------ */

export function FluencyHeadline({ card }: { card: FluencyScorecard }) {
  // `card.week_monday` carries the windowEnd date for the 30-day scorecard
  // (the only caller). Compute a 30-day-ago start so the kicker reads
  // "Apr 28 – May 27, 2026".
  const windowEnd = new Date(`${card.week_monday}T00:00:00`);
  const windowStart = new Date(windowEnd);
  windowStart.setDate(windowEnd.getDate() - 29);
  const dateLabel = `${windowStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${windowEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  const delta = card.score_prev
    ? card.score.numerator - card.score_prev.numerator
    : 0;
  const deltaLabel = card.score_prev
    ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} vs prior 30 days`
    : "first 30-day window";

  return (
    <header className="flu-headline">
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
          AI Fluency Report · {dateLabel}
        </div>
        <h1
          style={{
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: 0,
            lineHeight: 1.15,
          }}
        >
          How you&apos;re collaborating with your agents over the last 30 days, {card.member_name.split(" ")[0]}.
        </h1>
        <p
          className="flu-headline-summary"
          style={{
            margin: "14px 0 0",
            fontSize: 15,
            lineHeight: 1.6,
            color: "var(--af-text-secondary)",
            maxWidth: 720,
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
          Fluency score
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
          {fmtScore(card.score.numerator, card.score.denominator)}
        </div>
        <div
          style={{
            fontSize: 12,
            color: delta >= 0 ? "var(--af-success)" : "var(--af-danger)",
            fontWeight: 500,
          }}
        >
          {deltaLabel}
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */

export function FluencySurfaceMix({
  mix,
  label,
}: {
  mix: Record<AgentSourceKey, number>;
  label?: string;
}) {
  const entries = (Object.entries(mix) as Array<[AgentSourceKey, number]>)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  return (
    <section className="flu-surface-section" style={{ margin: "20px 0 4px" }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--af-text-tertiary)",
          marginBottom: 10,
        }}
      >
        {label ?? "Surfaces in the last 30 days"}
      </div>
      <div
        style={{
          display: "flex",
          width: "100%",
          height: 28,
          borderRadius: 8,
          overflow: "hidden",
          border: "1px solid var(--af-border-subtle)",
        }}
      >
        {entries.map(([k, v], i) => {
          const colors: Record<AgentSourceKey, string> = {
            "claude-code": "var(--af-accent)",
            codex: "#6366f1",
            gemini: "#f59e0b",
            opencode: "#8b5cf6",
            other: "var(--af-text-tertiary)",
          };
          return (
            <div
              key={k}
              style={{
                width: `${v * 100}%`,
                background: colors[k],
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "white",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.04em",
                borderRight: i < entries.length - 1 ? "1px solid rgba(255,255,255,0.2)" : "none",
              }}
              title={`${AGENT_SOURCE_LABEL[k]} — ${fmtPct(v)}`}
            >
              {v > 0.08 ? AGENT_SOURCE_LABEL[k] : ""}
            </div>
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          gap: 16,
          marginTop: 10,
          fontSize: 12,
          color: "var(--af-text-secondary)",
        }}
      >
        {entries.map(([k, v]) => (
          <span key={k}>
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                background: ({
                  "claude-code": "var(--af-accent)",
                  codex: "#6366f1",
                  gemini: "#f59e0b",
                  opencode: "#8b5cf6",
                  other: "var(--af-text-tertiary)",
                } as Record<AgentSourceKey, string>)[k],
                borderRadius: 2,
                marginRight: 6,
              }}
            />
            {AGENT_SOURCE_LABEL[k]} <strong style={{ color: "var(--af-text)" }}>{fmtPct(v)}</strong>
          </span>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function ObservationCard({
  axis,
  obs,
  highlight,
}: {
  axis: FluencyAxisMeta;
  obs: FluencyAxisObservation;
  highlight?: "strength" | "growth";
}) {
  const tone = ratingTone(obs.rating);
  const evidence = obs.evidence[0];
  return (
    <article
      style={{
        position: "relative",
        background: "var(--af-surface)",
        border: `1px solid ${highlight ? tone : "var(--af-border-subtle)"}`,
        borderRadius: 10,
        padding: "14px 16px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow: highlight ? `0 0 0 1px ${tone}1a` : "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--af-text-tertiary)",
            }}
          >
            {axis.id}
          </span>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              margin: 0,
              letterSpacing: "-0.005em",
            }}
          >
            {axis.title}
          </h3>
        </div>
        <span
          title={ratingLabel(obs.rating)}
          style={{
            color: tone,
            fontSize: 20,
            lineHeight: 1,
          }}
        >
          {ratingGlyph(obs.rating)}
        </span>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 12,
          color: "var(--af-text-secondary)",
          lineHeight: 1.5,
        }}
      >
        {axis.blurb}
      </p>
      {highlight && (
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: tone,
            fontWeight: 600,
          }}
        >
          {highlight === "strength" ? "Strength of the last 30 days" : "Grow here next"}
        </div>
      )}
      {evidence && (
        <EvidenceQuote ev={evidence} />
      )}
      {!evidence && obs.rating === "-" && (
        <div
          style={{
            fontSize: 12,
            color: "var(--af-text-tertiary)",
            fontStyle: "italic",
            paddingTop: 6,
            borderTop: "1px dashed var(--af-border-subtle)",
          }}
        >
          No evidence found in the last 30 days of transcripts. Try one of the moves in this axis on your next session and the report will surface it.
        </div>
      )}
      <SourceBreakdown by={obs.by_source} />
    </article>
  );
}

function EvidenceQuote({ ev }: { ev: FluencyEvidence }) {
  const body = (
    <blockquote
      style={{
        margin: 0,
        padding: "10px 12px",
        background: "var(--background)",
        borderLeft: "3px solid var(--af-accent)",
        borderRadius: 6,
        fontSize: 12.5,
        lineHeight: 1.5,
        color: "var(--af-text)",
      }}
    >
      &ldquo;{ev.quote}&rdquo;
      <div
        style={{
          marginTop: 6,
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {ev.date} · {AGENT_SOURCE_LABEL[ev.source]} · {ev.session_id.slice(0, 8)}
        {ev.project ? ` · ${ev.project}` : ""}
      </div>
    </blockquote>
  );
  // Derived signals are observer commentary, not real user turns — leave
  // them unlinked rather than pretending a turn-anchored link exists.
  if (ev.kind === "derived") return body;
  const hash = buildEvidenceHash(ev.quote, ev.turn_index);
  return (
    <a
      href={`/sessions/${ev.session_id}${hash}`}
      className="flu-evidence-link"
      style={{ textDecoration: "none", color: "inherit", display: "block" }}
      title="Open the source session and scroll to this turn"
    >
      {body}
    </a>
  );
}

function SourceBreakdown({ by }: { by: Partial<Record<AgentSourceKey, FluencyRating>> }) {
  const entries = (Object.entries(by) as Array<[AgentSourceKey, FluencyRating]>).filter(
    ([, r]) => !!r,
  );
  if (entries.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
      {entries.map(([src, rating]) => (
        <span
          key={src}
          style={{
            fontSize: 10,
            letterSpacing: "0.04em",
            padding: "3px 8px",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 999,
            color: "var(--af-text-secondary)",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <span style={{ color: ratingTone(rating) }}>{ratingGlyph(rating)}</span>
          {AGENT_SOURCE_LABEL[src]}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function FluencyAxisGrid({
  observations,
  strengthAxis,
  growthAxis,
}: {
  observations: FluencyAxisObservation[];
  strengthAxis?: FluencyAxisId;
  growthAxis?: FluencyAxisId;
}) {
  const byAxis = new Map<FluencyAxisId, FluencyAxisObservation>();
  for (const o of observations) byAxis.set(o.axis, o);

  return (
    <section style={{ marginTop: 28 }}>
      {PILLAR_ORDER.map((pillar) => {
        const axes = FLUENCY_AXES.filter((a) => a.pillar === pillar);
        return (
          <div key={pillar} style={{ marginBottom: 28 }}>
            <div
              className="flu-pillar-head"
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 12,
                marginBottom: 14,
                flexWrap: "wrap",
              }}
            >
              <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
                {PILLAR_LABEL[pillar]}
              </h2>
              <span style={{ fontSize: 13, color: "var(--af-text-secondary)" }}>
                {PILLAR_BLURB[pillar]}
              </span>
            </div>
            <div className="flu-axis-grid">
              {axes.map((axis) => {
                const obs = byAxis.get(axis.id);
                if (!obs) return null;
                const highlight =
                  axis.id === strengthAxis
                    ? "strength"
                    : axis.id === growthAxis
                      ? "growth"
                      : undefined;
                return <ObservationCard key={axis.id} axis={axis} obs={obs} highlight={highlight} />;
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/* ------------------------------------------------------------------ */

export function RiskTriangle({
  position,
  prev,
  label = "Your risk profile",
}: {
  position: RiskTrianglePosition;
  prev?: RiskTrianglePosition;
  label?: string;
}) {
  // Equilateral triangle corners with safe padding so labels can sit outside
  const w = 340;
  const h = 290;
  // Polish-without-check (top), Iterate (bottom-left), Verify (bottom-right)
  const top = { x: w / 2, y: 22 };
  const bl = { x: 30, y: h - 38 };
  const br = { x: w - 30, y: h - 38 };

  // Barycentric → cartesian: position values are 0..1, summing to ~1.
  const centroid = (p: RiskTrianglePosition) => {
    const sum = p.polish_without_check + p.iterate_without_verify + p.verify_without_iterate || 1;
    const a = p.polish_without_check / sum;
    const b = p.iterate_without_verify / sum;
    const c = p.verify_without_iterate / sum;
    return {
      x: a * top.x + b * bl.x + c * br.x,
      y: a * top.y + b * bl.y + c * br.y,
    };
  };

  const cur = centroid(position);
  const before = prev ? centroid(prev) : null;

  return (
    <section
      style={{
        marginTop: 36,
        padding: "22px 22px 18px",
        background: "var(--af-surface)",
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 12,
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--af-text-tertiary)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <h3 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>
        Risk Triangle
      </h3>
      <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--af-text-secondary)", maxWidth: 540 }}>
        Anthropic&apos;s research found polished output reduces critical checking. The triangle shows your tendency to
        drift toward one of three failure modes. Movement toward the centre = balanced practice.
      </p>
      <div className="flu-risk-grid">
        <svg
          className="flu-risk-svg"
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ overflow: "visible" }}
        >
          <polygon
            points={`${top.x},${top.y} ${bl.x},${bl.y} ${br.x},${br.y}`}
            fill="var(--background)"
            stroke="var(--af-border-subtle)"
            strokeWidth={1}
          />
          {/* center line / midpoint indicator */}
          <circle
            cx={(top.x + bl.x + br.x) / 3}
            cy={(top.y + bl.y + br.y) / 3}
            r={3}
            fill="var(--af-text-tertiary)"
            opacity={0.4}
          />

          {before && (
            <>
              <line
                x1={before.x}
                y1={before.y}
                x2={cur.x}
                y2={cur.y}
                stroke="var(--af-text-tertiary)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <circle cx={before.x} cy={before.y} r={4} fill="var(--af-text-tertiary)" opacity={0.6} />
            </>
          )}

          <circle cx={cur.x} cy={cur.y} r={8} fill="var(--af-accent)" />
          <circle cx={cur.x} cy={cur.y} r={14} fill="var(--af-accent)" opacity={0.18} />

          {/* corner labels */}
          <text x={top.x} y={top.y - 8} textAnchor="middle" fontSize={11} fill="var(--af-text)" fontWeight={600}>
            Polish-without-check
          </text>
          <text x={bl.x - 4} y={bl.y + 18} textAnchor="start" fontSize={11} fill="var(--af-text)" fontWeight={600}>
            Iterate-without-verify
          </text>
          <text x={br.x + 4} y={bl.y + 18} textAnchor="end" fontSize={11} fill="var(--af-text)" fontWeight={600}>
            Verify-without-iterate
          </text>
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <RiskRow
            label="Polish-without-check"
            value={position.polish_without_check}
            prev={prev?.polish_without_check}
            blurb="Polished output accepted without verification turns."
          />
          <RiskRow
            label="Iterate-without-verify"
            value={position.iterate_without_verify}
            prev={prev?.iterate_without_verify}
            blurb="Refined into a comfortable answer, never tested."
          />
          <RiskRow
            label="Verify-without-iterate"
            value={position.verify_without_iterate}
            prev={prev?.verify_without_iterate}
            blurb="Checked once, shipped first draft anyway."
          />
        </div>
      </div>
    </section>
  );
}

function RiskRow({
  label,
  value,
  prev,
  blurb,
}: {
  label: string;
  value: number;
  prev?: number;
  blurb: string;
}) {
  const delta = prev !== undefined ? value - prev : undefined;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong style={{ fontSize: 13 }}>{label}</strong>
        <span style={{ fontSize: 13, color: "var(--af-text)", fontFamily: "var(--font-mono)" }}>
          {fmtPct(value)}
          {delta !== undefined && (
            <span
              style={{
                marginLeft: 8,
                color: delta < 0 ? "var(--af-success)" : delta > 0 ? "var(--af-danger)" : "var(--af-text-tertiary)",
                fontSize: 11,
              }}
            >
              {delta > 0 ? "+" : ""}{(delta * 100).toFixed(0)}pp
            </span>
          )}
        </span>
      </div>
      <div style={{ marginTop: 4, height: 6, background: "var(--background)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: fmtPct(value), height: "100%", background: "var(--af-accent)" }} />
      </div>
      <div style={{ marginTop: 4, fontSize: 11, color: "var(--af-text-tertiary)", lineHeight: 1.5 }}>{blurb}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function GrowthCallout({ card }: { card: FluencyScorecard }) {
  const growth = FLUENCY_AXIS_BY_ID[card.growth_axis];
  const strength = FLUENCY_AXIS_BY_ID[card.strength_axis];
  return (
    <section className="flu-growth-grid" style={{ marginTop: 32 }}>
      <Callout
        tone="success"
        kicker="Strength to keep"
        axis={strength}
        body={`You consistently demonstrated ${strength.title.toLowerCase()} across the last 30 days. Anchor the rest of your team to this — name it in CLAUDE.md, share it in #eng-claude.`}
      />
      <Callout
        tone="warning"
        kicker="Lever for next 30 days"
        axis={growth}
        body={`${growth.observable} Pick one session in the next few days and add this step deliberately — the report will pick it up automatically.`}
      />
    </section>
  );
}

function Callout({
  tone,
  kicker,
  axis,
  body,
}: {
  tone: "success" | "warning";
  kicker: string;
  axis: FluencyAxisMeta;
  body: string;
}) {
  const accent = tone === "success" ? "var(--af-success)" : "var(--af-warning)";
  const bg = tone === "success" ? "var(--af-success-subtle)" : "var(--af-warning-subtle)";
  return (
    <article
      style={{
        background: bg,
        border: `1px solid ${accent}`,
        borderRadius: 12,
        padding: "16px 18px",
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: accent,
          fontWeight: 700,
        }}
      >
        {kicker}
      </div>
      <h3 style={{ margin: "6px 0 8px", fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--af-text-tertiary)", marginRight: 8 }}>
          {axis.id}
        </span>
        {axis.title}
      </h3>
      <p style={{ margin: 0, fontSize: 13, color: "var(--af-text)", lineHeight: 1.55 }}>{body}</p>
    </article>
  );
}

/* ------------------------------------------------------------------ */

export function FluencyFooter({ schemaVersion }: { schemaVersion: number }) {
  return (
    <footer
      style={{
        marginTop: 48,
        paddingTop: 20,
        borderTop: "1px solid var(--af-border-subtle)",
        fontSize: 11,
        color: "var(--af-text-tertiary)",
        lineHeight: 1.7,
        maxWidth: 720,
      }}
    >
      Fluency framework v{schemaVersion}. Eleven axes across three pillars, adapted for coding agents from
      Anthropic&apos;s 4D AI Fluency framework. Evidence quotes come verbatim from your own transcripts — Claude Code,
      Codex CLI, Gemini CLI. Your scorecard is private to you; only opt-in highlights ever leave this view.
    </footer>
  );
}

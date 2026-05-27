/**
 * Personal AI Fluency report — v2 layout.
 *
 * Hero structure:
 *   row 1: kicker · big display name · three tier pills (counts)
 *   row 2: capability triangle (radar of pillar coverage) | three stacked
 *          pillar score cards (each with own numerator/denominator)
 *   row 3: short window descriptor
 *
 * Below the hero, one airier section per pillar with restructured axis
 * rows: index → tier glyph badge → axis title → surface chips on right
 * → indented verbatim evidence quotes with a subtle left rule.
 *
 * Risk Triangle + Growth Callouts continue below — they cover concerns
 * the capability triangle doesn't (failure modes, coaching nudges).
 */

import type {
  AgentSourceKey,
  FluencyAxisId,
  FluencyAxisMeta,
  FluencyAxisObservation,
  FluencyEvidence,
  FluencyPillar,
  FluencyRating,
  FluencyScorecard,
} from "@claude-lens/entries/fluency";
import {
  AGENT_SOURCE_LABEL,
  FLUENCY_AXES,
  FLUENCY_AXIS_BY_ID,
  PILLAR_LABEL,
} from "@claude-lens/entries/fluency";

const PILLAR_ORDER: FluencyPillar[] = ["delegation", "description", "discernment"];

/** Friendlier subtitle for each pillar — kicker keeps the technical name,
 *  these read as one-line plain-English headlines on the score cards. */
const PILLAR_SUBTITLE: Record<FluencyPillar, string> = {
  delegation: "Setting the task up",
  description: "Framing what you need",
  discernment: "Evaluating what comes back",
};

/** Accent colour per pillar — used for the left-border accent on score
 *  cards and the vertex colour on the capability triangle. */
const PILLAR_ACCENT: Record<FluencyPillar, string> = {
  delegation: "var(--af-accent)",
  description: "var(--af-info)",
  discernment: "var(--af-success)",
};

const PILLAR_AXES: Record<FluencyPillar, FluencyAxisId[]> = {
  delegation: ["D1", "D2", "D3"],
  description: ["De1", "De2", "De3", "De4"],
  discernment: ["Di1", "Di2", "Di3", "Di4"],
};

/* ------------------------------------------------------------------ */

function glyph(r: FluencyRating): string {
  return r === "+" ? "+" : r === "~" ? "~" : r === "-" ? "−" : "·";
}
function tone(r: FluencyRating): string {
  return r === "+" ? "var(--af-success)" :
         r === "~" ? "var(--af-warning)" :
         r === "-" ? "var(--af-danger)" :
         "var(--af-text-tertiary)";
}
function ratingValue(r: FluencyRating): number {
  return r === "+" ? 1 : r === "~" ? 0.5 : 0;
}

function pillarScore(obs: FluencyAxisObservation[], pillar: FluencyPillar): { score: number; max: number; demonstrated: number; partial: number; notObserved: number } {
  const axisIds = PILLAR_AXES[pillar];
  let score = 0;
  let demonstrated = 0;
  let partial = 0;
  let notObserved = 0;
  for (const id of axisIds) {
    const o = obs.find((x) => x.axis === id);
    if (!o) continue;
    score += ratingValue(o.rating);
    if (o.rating === "+") demonstrated += 1;
    else if (o.rating === "~") partial += 1;
    else if (o.rating === "-") notObserved += 1;
  }
  return { score, max: axisIds.length, demonstrated, partial, notObserved };
}

function fmtFrac(num: number, denom: number): string {
  return `${num % 1 === 0 ? num.toFixed(0) : num.toFixed(1)} / ${denom}`;
}

function tierCounts(obs: FluencyAxisObservation[]): { demonstrated: number; partial: number; notObserved: number } {
  let d = 0, p = 0, n = 0;
  for (const o of obs) {
    if (o.rating === "+") d += 1;
    else if (o.rating === "~") p += 1;
    else if (o.rating === "-") n += 1;
  }
  return { demonstrated: d, partial: p, notObserved: n };
}

/* ------------------------------------------------------------------ */
/*  Tier pills                                                          */
/* ------------------------------------------------------------------ */

export function TierPills({ counts }: { counts: { demonstrated: number; partial: number; notObserved: number } }) {
  const pill = (n: number, label: string, color: string) => (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 14px",
        borderRadius: 999,
        border: `1px solid ${color}`,
        background: "transparent",
        fontSize: 12.5,
        fontWeight: 500,
        color: "var(--af-text)",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 7, height: 7, background: color, borderRadius: 999, display: "inline-block" }} />
      <strong style={{ color: "var(--af-text)" }}>{n}</strong>{" "}
      <span style={{ color: "var(--af-text-secondary)" }}>{label}</span>
    </span>
  );
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {pill(counts.demonstrated, "demonstrated", "var(--af-success)")}
      {pill(counts.partial,      "partial",      "var(--af-warning)")}
      {pill(counts.notObserved,  "not observed", "var(--af-danger)")}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Capability triangle                                                 */
/* ------------------------------------------------------------------ */

export function CapabilityTriangle({ observations }: { observations: FluencyAxisObservation[] }) {
  const d = pillarScore(observations, "delegation");
  const desc = pillarScore(observations, "description");
  const di = pillarScore(observations, "discernment");
  // Wide viewBox so the long label words ("Discernment" / "Description")
  // never clip on the outer vertices. Center is offset down 16 px so the
  // top vertex label fits above without a top margin hack.
  const w = 420, h = 360;
  const cx = w / 2, cy = h / 2 + 16;
  const radius = 116;
  // Three vertices: Delegation top, Description bottom-right, Discernment bottom-left
  // Angles in radians measured from -PI/2 (top) clockwise
  const angles = {
    delegation: -Math.PI / 2,
    description: -Math.PI / 2 + (2 * Math.PI) / 3,
    discernment: -Math.PI / 2 + (4 * Math.PI) / 3,
  };
  const vertex = (angle: number, r: number) => ({
    x: cx + Math.cos(angle) * r,
    y: cy + Math.sin(angle) * r,
  });
  const outer = {
    delegation: vertex(angles.delegation, radius),
    description: vertex(angles.description, radius),
    discernment: vertex(angles.discernment, radius),
  };
  // Pillar coverage normalised to 0..1. Floor at 0.08 so a 0-score vertex
  // still shows a visible dot near the center rather than collapsing to it.
  const minVisible = 0.08;
  const cov = {
    delegation: Math.max(minVisible, d.score / d.max),
    description: Math.max(minVisible, desc.score / desc.max),
    discernment: Math.max(minVisible, di.score / di.max),
  };
  const inner = {
    delegation: vertex(angles.delegation, radius * cov.delegation),
    description: vertex(angles.description, radius * cov.description),
    discernment: vertex(angles.discernment, radius * cov.discernment),
  };

  // Concentric reference rings at 0.33, 0.66, 1.0
  const ring = (frac: number) =>
    `M ${vertex(angles.delegation, radius * frac).x},${vertex(angles.delegation, radius * frac).y}
     L ${vertex(angles.description, radius * frac).x},${vertex(angles.description, radius * frac).y}
     L ${vertex(angles.discernment, radius * frac).x},${vertex(angles.discernment, radius * frac).y} Z`;

  return (
    <div
      style={{
        background: "var(--af-surface)",
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 14,
        padding: "20px 22px 22px",
        position: "relative",
      }}
      className="flu-capability"
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "var(--af-text-tertiary)",
          fontFamily: "var(--font-mono)",
          marginBottom: 4,
        }}
      >
        Capability profile
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block" }}
      >
        {/* Reference rings */}
        <path d={ring(1)}   fill="none" stroke="var(--af-border-subtle)" strokeWidth={1} />
        <path d={ring(0.66)} fill="none" stroke="var(--af-border-subtle)" strokeWidth={0.5} opacity={0.6} />
        <path d={ring(0.33)} fill="none" stroke="var(--af-border-subtle)" strokeWidth={0.5} opacity={0.4} />

        {/* Spokes from center to outer vertices */}
        {(["delegation", "description", "discernment"] as const).map((p) => (
          <line
            key={p}
            x1={cx} y1={cy}
            x2={outer[p].x} y2={outer[p].y}
            stroke="var(--af-border-subtle)"
            strokeWidth={0.5}
            opacity={0.4}
          />
        ))}

        {/* Filled capability polygon */}
        <polygon
          points={`${inner.delegation.x},${inner.delegation.y} ${inner.description.x},${inner.description.y} ${inner.discernment.x},${inner.discernment.y}`}
          fill="var(--af-accent)"
          fillOpacity={0.15}
          stroke="var(--af-accent)"
          strokeWidth={1.5}
        />

        {/* Vertex dots */}
        {(["delegation", "description", "discernment"] as const).map((p) => (
          <circle
            key={p}
            cx={inner[p].x} cy={inner[p].y}
            r={4.5}
            fill={PILLAR_ACCENT[p]}
            stroke="var(--af-surface)"
            strokeWidth={1.5}
          />
        ))}

        {/* Pillar labels with score fraction underneath each vertex */}
        <text
          x={outer.delegation.x}
          y={outer.delegation.y - 16}
          textAnchor="middle"
          fontSize={12}
          fill="var(--af-text)"
          fontWeight={600}
        >
          Delegation
        </text>
        <text
          x={outer.delegation.x}
          y={outer.delegation.y - 4}
          textAnchor="middle"
          fontSize={10}
          fill="var(--af-text-tertiary)"
          fontFamily="var(--font-mono)"
        >
          {fmtFrac(d.score, d.max)}
        </text>
        <text
          x={outer.description.x}
          y={outer.description.y + 24}
          textAnchor="middle"
          fontSize={12}
          fill="var(--af-text)"
          fontWeight={600}
        >
          Description
        </text>
        <text
          x={outer.description.x}
          y={outer.description.y + 38}
          textAnchor="middle"
          fontSize={10}
          fill="var(--af-text-tertiary)"
          fontFamily="var(--font-mono)"
        >
          {fmtFrac(desc.score, desc.max)}
        </text>
        <text
          x={outer.discernment.x}
          y={outer.discernment.y + 24}
          textAnchor="middle"
          fontSize={12}
          fill="var(--af-text)"
          fontWeight={600}
        >
          Discernment
        </text>
        <text
          x={outer.discernment.x}
          y={outer.discernment.y + 38}
          textAnchor="middle"
          fontSize={10}
          fill="var(--af-text-tertiary)"
          fontFamily="var(--font-mono)"
        >
          {fmtFrac(di.score, di.max)}
        </text>
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Pillar score cards                                                  */
/* ------------------------------------------------------------------ */

export function PillarScoreCard({
  pillar,
  observations,
}: {
  pillar: FluencyPillar;
  observations: FluencyAxisObservation[];
}) {
  const s = pillarScore(observations, pillar);
  return (
    <div
      style={{
        background: "var(--af-surface)",
        border: "1px solid var(--af-border-subtle)",
        borderLeft: `3px solid ${PILLAR_ACCENT[pillar]}`,
        borderRadius: 10,
        padding: "16px 20px",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 18,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--af-text-tertiary)",
            fontFamily: "var(--font-mono)",
            marginBottom: 4,
          }}
        >
          {PILLAR_LABEL[pillar]}
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.005em" }}>
          {PILLAR_SUBTITLE[pillar]}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--af-text-secondary)" }}>
          <span style={{ color: "var(--af-success)" }}>● {s.demonstrated}</span>
          {" · "}
          <span style={{ color: "var(--af-warning)" }}>◐ {s.partial}</span>
          {" · "}
          <span style={{ color: "var(--af-danger)" }}>○ {s.notObserved}</span>
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div
          style={{
            fontSize: 34,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "var(--af-text)",
            lineHeight: 1,
          }}
        >
          {s.score % 1 === 0 ? s.score.toFixed(0) : s.score.toFixed(1)}
          <span style={{ fontSize: 16, color: "var(--af-text-tertiary)", marginLeft: 2 }}>/{s.max}</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Hero — name + tier pills + two-col (triangle + pillar cards)       */
/* ------------------------------------------------------------------ */

export function FluencyHeroV2({ card }: { card: FluencyScorecard }) {
  const weekStart = new Date(`${card.week_monday}T00:00:00`);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const dateLabel = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  const counts = tierCounts(card.observations);
  const surfaceLine = surfaceMixLabel(card.surface_mix);

  return (
    <>
      {/* Row 1 — kicker, name, tier pills */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: 24,
          alignItems: "center",
          paddingTop: 18,
        }}
        className="flu-hero-row"
      >
        <div>
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "var(--af-text-tertiary)",
              fontFamily: "var(--font-mono)",
              marginBottom: 8,
            }}
          >
            AI Fluency Assessment
          </div>
          <h1
            style={{
              fontSize: 48,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              margin: 0,
              lineHeight: 1.05,
            }}
            className="flu-hero-name"
          >
            {card.member_name}
          </h1>
          <div
            style={{
              marginTop: 8,
              fontSize: 13,
              color: "var(--af-text-secondary)",
            }}
          >
            {dateLabel} · {surfaceLine}
          </div>
        </div>
        <div className="flu-hero-pills">
          <TierPills counts={counts} />
        </div>
      </div>

      <hr
        style={{
          marginTop: 22,
          marginBottom: 22,
          border: "none",
          borderTop: "1px solid var(--af-border-subtle)",
        }}
      />

      {/* Row 2 — two-column hero: triangle | pillar score cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)",
          gap: 22,
          alignItems: "stretch",
        }}
        className="flu-hero-grid"
      >
        <CapabilityTriangle observations={card.observations} />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {PILLAR_ORDER.map((p) => (
            <PillarScoreCard key={p} pillar={p} observations={card.observations} />
          ))}
        </div>
      </div>

      {/* Row 3 — summary paragraph */}
      <p
        style={{
          marginTop: 22,
          marginBottom: 0,
          fontSize: 14.5,
          lineHeight: 1.65,
          color: "var(--af-text-secondary)",
          maxWidth: 820,
        }}
      >
        {card.summary}
      </p>
    </>
  );
}

function surfaceMixLabel(mix: Record<AgentSourceKey, number>): string {
  const entries = (Object.entries(mix) as Array<[AgentSourceKey, number]>)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "no active surfaces";
  return entries
    .map(([k, v]) => `${AGENT_SOURCE_LABEL[k]} ${Math.round(v * 100)}%`)
    .join(" · ");
}

/* ------------------------------------------------------------------ */
/*  Per-axis row + per-pillar detail section                            */
/* ------------------------------------------------------------------ */

export function PillarDetailSection({
  pillar,
  observations,
  strengthAxis,
  growthAxis,
}: {
  pillar: FluencyPillar;
  observations: FluencyAxisObservation[];
  strengthAxis?: FluencyAxisId;
  growthAxis?: FluencyAxisId;
}) {
  const axes = FLUENCY_AXES.filter((a) => a.pillar === pillar);
  return (
    <section style={{ marginTop: 32 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          paddingBottom: 10,
          marginBottom: 16,
          borderBottom: "1px solid var(--af-border-subtle)",
        }}
      >
        <h2
          style={{
            fontSize: 11,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "var(--af-text-tertiary)",
            fontFamily: "var(--font-mono)",
            fontWeight: 600,
            margin: 0,
          }}
        >
          {PILLAR_LABEL[pillar]}
        </h2>
        <span
          style={{
            fontSize: 13,
            color: "var(--af-text-secondary)",
          }}
        >
          — {PILLAR_SUBTITLE[pillar]}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {axes.map((axis, i) => {
          const obs = observations.find((o) => o.axis === axis.id);
          if (!obs) return null;
          const isStrength = axis.id === strengthAxis;
          const isGrowth = axis.id === growthAxis;
          return (
            <AxisRowV2
              key={axis.id}
              index={i}
              axis={axis}
              obs={obs}
              highlight={isStrength ? "strength" : isGrowth ? "growth" : undefined}
            />
          );
        })}
      </div>
    </section>
  );
}

function AxisRowV2({
  index,
  axis,
  obs,
  highlight,
}: {
  index: number;
  axis: FluencyAxisMeta;
  obs: FluencyAxisObservation;
  highlight?: "strength" | "growth";
}) {
  const t = tone(obs.rating);
  return (
    <article
      style={{
        display: "grid",
        gridTemplateColumns: "32px auto minmax(0, 1fr) auto",
        gap: 14,
        alignItems: "start",
        padding: "10px 14px 14px",
        borderRadius: 10,
        border: highlight ? `1px solid ${t}` : "1px solid var(--af-border-subtle)",
        background: highlight ? `${t}0d` : "var(--af-surface)",
      }}
      className="flu-axis-row-v2"
    >
      {/* Index */}
      <div
        style={{
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color: "var(--af-text-tertiary)",
          paddingTop: 4,
        }}
      >
        {String(index).padStart(2, "0")}
      </div>

      {/* Tier glyph badge */}
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          border: `1.5px solid ${t}`,
          background: `${t}1a`,
          color: t,
          fontWeight: 700,
          fontSize: 15,
          fontFamily: "var(--font-mono)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
          marginTop: 1,
        }}
        title={obs.rating === "+" ? "Demonstrated" : obs.rating === "~" ? "Partial" : obs.rating === "-" ? "Not observed" : "N/A"}
      >
        {glyph(obs.rating)}
      </div>

      {/* Title + blurb + evidence */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              color: "var(--af-text-tertiary)",
            }}
          >
            {axis.id}
          </span>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, letterSpacing: "-0.005em" }}>
            {axis.title}
          </h3>
          {highlight && (
            <span
              style={{
                fontSize: 9,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: t,
                fontWeight: 700,
                fontFamily: "var(--font-mono)",
              }}
            >
              {highlight === "strength" ? "This week's strength" : "Grow here next"}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--af-text-secondary)", marginTop: 2 }}>
          {axis.blurb}
        </div>
        {obs.evidence.length > 0 ? (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {obs.evidence.map((e, i) => (
              <EvidenceQuoteV2 key={i} ev={e} />
            ))}
          </div>
        ) : obs.rating === "-" ? (
          <div
            style={{
              marginTop: 10,
              fontSize: 12,
              color: "var(--af-text-tertiary)",
              fontStyle: "italic",
              paddingLeft: 12,
              borderLeft: "2px dashed var(--af-border-subtle)",
            }}
          >
            No evidence found in this week&apos;s transcripts.
          </div>
        ) : null}
      </div>

      {/* Surface chips (top-right) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end", paddingTop: 4 }}>
        {Object.entries(obs.by_source)
          .filter(([, r]) => !!r)
          .map(([src, rating]) => (
            <span
              key={src}
              style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                padding: "2px 8px",
                background: "var(--background)",
                border: "1px solid var(--af-border-subtle)",
                borderRadius: 999,
                color: "var(--af-text-secondary)",
                whiteSpace: "nowrap",
              }}
              title={`${AGENT_SOURCE_LABEL[src as AgentSourceKey]}: ${rating}`}
            >
              <span style={{ color: tone(rating as FluencyRating), marginRight: 4 }}>{glyph(rating as FluencyRating)}</span>
              {AGENT_SOURCE_LABEL[src as AgentSourceKey].toLowerCase().replace(/\s+/g, "")}
            </span>
          ))}
      </div>
    </article>
  );
}

function EvidenceQuoteV2({ ev }: { ev: FluencyEvidence }) {
  return (
    <blockquote
      style={{
        margin: 0,
        padding: "8px 14px 8px 16px",
        borderLeft: "2px solid var(--af-accent)",
        background: "var(--background)",
        borderRadius: "0 6px 6px 0",
      }}
    >
      <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--af-text)", fontStyle: "italic" }}>
        &ldquo;{ev.quote}&rdquo;
      </div>
      <div
        style={{
          marginTop: 5,
          fontSize: 10.5,
          color: "var(--af-text-tertiary)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {AGENT_SOURCE_LABEL[ev.source].toLowerCase().replace(/\s+/g, "")} · {ev.date} · {ev.session_id.slice(0, 8)}
        {ev.project ? ` · ${ev.project}` : ""}
      </div>
    </blockquote>
  );
}

/* ------------------------------------------------------------------ */
/*  Page composer                                                       */
/* ------------------------------------------------------------------ */

export function FluencyDetailSections({ card }: { card: FluencyScorecard }) {
  return (
    <>
      {PILLAR_ORDER.map((p) => (
        <PillarDetailSection
          key={p}
          pillar={p}
          observations={card.observations}
          strengthAxis={card.strength_axis}
          growthAxis={card.growth_axis}
        />
      ))}
    </>
  );
}

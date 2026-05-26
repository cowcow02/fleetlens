// Team AI Fluency Report — server component.
// Uses the editorial team-server design tokens (Instrument Serif headings,
// JetBrains Mono kickers, paper / ink palette). Manager-only view: never
// shows per-member scorecards, only distributions and opt-in highlights.

import type {
  AgentSourceKey,
  FluencyAxisDistribution,
  FluencyAxisId,
  FluencyAxisMeta,
  FluencyDiffusionEdge,
  FluencyHighlight,
  FluencyNormsTrajectory,
  RiskTrianglePosition,
  TeamFluencyReport,
} from "@claude-lens/entries/fluency";
import {
  AGENT_SOURCE_LABEL,
  FLUENCY_AXES,
  FLUENCY_AXIS_BY_ID,
  PILLAR_BLURB,
  PILLAR_LABEL,
} from "@claude-lens/entries/fluency";

const SOURCE_COLOR: Record<AgentSourceKey, string> = {
  "claude-code": "var(--accent)",
  codex: "#3a7d44",
  gemini: "#a3722f",
  opencode: "#5a3f8a",
  other: "var(--mute)",
};

function fmtPct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/* ------------------------------------------------------------------ */
/*  Headline                                                            */
/* ------------------------------------------------------------------ */

export function FluencyHeadline({ report }: { report: TeamFluencyReport }) {
  const start = new Date(`${report.week_monday}T00:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric" }).toUpperCase();

  const delta =
    report.team_score.prev_value !== undefined
      ? report.team_score.value - report.team_score.prev_value
      : 0;

  return (
    <>
      <div className="section-head">
        <div>
          <h1>
            <em>AI Fluency</em> · Week of {fmtDate(start)} – {fmtDate(end)}
          </h1>
          <div className="kicker" style={{ marginTop: 10 }}>
            {report.team_name.toUpperCase()} · {report.members_active} ACTIVE / {report.members_total} TOTAL · 11 AXES · MANAGER VIEW
          </div>
        </div>
        <div className="kicker">v{report.schema_version} · prototype data</div>
      </div>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: 32,
          alignItems: "start",
          marginBottom: 36,
        }}
      >
        <div>
          <p
            style={{
              fontFamily: "Instrument Serif, serif",
              fontSize: 24,
              lineHeight: 1.4,
              letterSpacing: "-0.01em",
              margin: 0,
              maxWidth: 740,
            }}
          >
            Your team&apos;s collective AI-collaboration practice is up{" "}
            <em style={{ color: "var(--accent)" }}>+{delta.toFixed(1)}</em> over last week, driven by{" "}
            <em>plan-gating</em> and <em>iterative refinement</em> diffusing across the team. The remaining
            risk corner is <em>polish-without-check</em>: 4 of 8 engineers still merge polished Claude output
            without a verify step.
          </p>
        </div>
        <div
          style={{
            border: "1px solid var(--ink)",
            background: "var(--paper)",
            padding: "22px 24px",
            minWidth: 220,
            textAlign: "right",
          }}
        >
          <div className="pulse-tile-label" style={{ margin: 0 }}>Team score</div>
          <div
            style={{
              fontFamily: "Instrument Serif, serif",
              fontSize: 56,
              lineHeight: 1,
              color: "var(--accent)",
              marginTop: 6,
            }}
          >
            {report.team_score.value.toFixed(1)}
            <span style={{ fontSize: 22, color: "var(--mute)", marginLeft: 6 }}>/ {report.team_score.max}</span>
          </div>
          <div
            className="pulse-tile-delta"
            style={{ marginTop: 10, color: delta >= 0 ? "var(--positive)" : "var(--danger)", fontWeight: 600 }}
          >
            {delta >= 0 ? "+" : ""}{delta.toFixed(1)} vs last week
          </div>
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Distribution                                                        */
/* ------------------------------------------------------------------ */

export function DistributionBlock({ rows }: { rows: FluencyAxisDistribution[] }) {
  const byAxis = new Map<FluencyAxisId, FluencyAxisDistribution>();
  for (const r of rows) byAxis.set(r.axis, r);

  return (
    <section className="insights-section">
      <div className="subsection-head">
        <h2>
          <span className="section-letter">A</span> Distribution per axis
        </h2>
        <span className="kicker">demonstrated · partial · not-observed</span>
      </div>
      <p style={{ marginTop: 0, marginBottom: 14, fontSize: 13, color: "var(--mute)", maxWidth: 700 }}>
        For each axis, how many of your {(rows[0]?.total ?? 0)} active engineers Demonstrated / Partially demonstrated / did
        not show evidence this week. The team headline above is the demonstrated count summed across axes.
      </p>
      {(["delegation", "description", "discernment"] as const).map((pillar) => {
        const axes = FLUENCY_AXES.filter((a) => a.pillar === pillar);
        return (
          <div key={pillar} style={{ marginBottom: 26 }}>
            <div className="harness-block-title">
              {PILLAR_LABEL[pillar]} — <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>{PILLAR_BLURB[pillar]}</span>
            </div>
            {axes.map((axis) => {
              const row = byAxis.get(axis.id);
              if (!row) return null;
              return <AxisRow key={axis.id} axis={axis} row={row} />;
            })}
          </div>
        );
      })}
    </section>
  );
}

function AxisRow({ axis, row }: { axis: FluencyAxisMeta; row: FluencyAxisDistribution }) {
  const total = row.total || 1;
  const dPct = row.demonstrated / total;
  const pPct = row.partial / total;
  const nPct = row.not_observed / total;
  const dDelta = row.demonstrated_prev !== undefined ? row.demonstrated - row.demonstrated_prev : undefined;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "140px 1fr 240px",
        gap: 18,
        alignItems: "center",
        padding: "10px 0",
        borderBottom: "1px solid var(--rule-soft)",
      }}
    >
      <div>
        <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--mute)" }}>{axis.id}</div>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>{axis.title}</div>
      </div>
      <div>
        <div
          className="stacked-bar"
          aria-label={`${axis.title}: ${row.demonstrated} demonstrated, ${row.partial} partial, ${row.not_observed} not observed`}
        >
          <div className="stacked-bar-seg" style={{ width: fmtPct(dPct), background: "var(--positive)" }} />
          <div className="stacked-bar-seg" style={{ width: fmtPct(pPct), background: "var(--warning)" }} />
          <div className="stacked-bar-seg" style={{ width: fmtPct(nPct), background: "var(--rule)" }} />
        </div>
        <div style={{ marginTop: 5, fontSize: 11, color: "var(--mute)", display: "flex", gap: 16 }}>
          <span>{axis.observable}</span>
        </div>
      </div>
      <div style={{ textAlign: "right", fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "var(--ink-soft)" }}>
        <div>
          <span style={{ color: "var(--positive)" }}>●</span> {row.demonstrated}
          <span style={{ color: "var(--warning)", marginLeft: 14 }}>◐</span> {row.partial}
          <span style={{ color: "var(--rule)", marginLeft: 14 }}>○</span> {row.not_observed}
        </div>
        {dDelta !== undefined && (
          <div
            style={{
              marginTop: 4,
              fontSize: 10,
              color: dDelta > 0 ? "var(--positive)" : dDelta < 0 ? "var(--danger)" : "var(--mute)",
            }}
          >
            {dDelta > 0 ? "▲" : dDelta < 0 ? "▼" : "→"} {dDelta >= 0 ? "+" : ""}{dDelta} demonstrated vs last week
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Risk Triangle                                                       */
/* ------------------------------------------------------------------ */

export function TeamRiskTriangle({
  position,
  prev,
}: {
  position: RiskTrianglePosition;
  prev?: RiskTrianglePosition;
}) {
  const w = 380;
  const h = 320;
  const top = { x: w / 2, y: 26 };
  const bl = { x: 36, y: h - 44 };
  const br = { x: w - 36, y: h - 44 };

  const centroid = (p: RiskTrianglePosition) => {
    const sum = p.polish_without_check + p.iterate_without_verify + p.verify_without_iterate || 1;
    const a = p.polish_without_check / sum;
    const b = p.iterate_without_verify / sum;
    const c = p.verify_without_iterate / sum;
    return { x: a * top.x + b * bl.x + c * br.x, y: a * top.y + b * bl.y + c * br.y };
  };
  const cur = centroid(position);
  const before = prev ? centroid(prev) : null;

  return (
    <section className="insights-section">
      <div className="subsection-head">
        <h2>
          <span className="section-letter">B</span> Risk Triangle
        </h2>
        <span className="kicker">team centroid · this week vs last</span>
      </div>
      <p style={{ marginTop: 0, marginBottom: 18, fontSize: 13, color: "var(--mute)", maxWidth: 700 }}>
        Three failure modes derived from Anthropic&apos;s February 2026 finding that polished outputs reduce critical
        checking. Movement toward the centre = balanced practice maturing. Drift toward a corner = the relevant risk increasing.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: `${w + 30}px 1fr`, gap: 32, alignItems: "center" }}>
        <svg width={w} height={h} style={{ overflow: "visible" }}>
          <polygon
            points={`${top.x},${top.y} ${bl.x},${bl.y} ${br.x},${br.y}`}
            fill="var(--paper)"
            stroke="var(--ink)"
            strokeWidth={1}
          />
          <circle
            cx={(top.x + bl.x + br.x) / 3}
            cy={(top.y + bl.y + br.y) / 3}
            r={3}
            fill="var(--mute)"
            opacity={0.4}
          />
          {before && (
            <>
              <line
                x1={before.x}
                y1={before.y}
                x2={cur.x}
                y2={cur.y}
                stroke="var(--mute)"
                strokeWidth={1}
                strokeDasharray="4 3"
              />
              <circle cx={before.x} cy={before.y} r={5} fill="var(--mute)" opacity={0.6} />
              <text
                x={before.x + 8}
                y={before.y - 6}
                fontSize={10}
                fill="var(--mute)"
                fontFamily="JetBrains Mono, monospace"
              >
                last week
              </text>
            </>
          )}
          <circle cx={cur.x} cy={cur.y} r={9} fill="var(--accent)" />
          <circle cx={cur.x} cy={cur.y} r={16} fill="var(--accent)" opacity={0.18} />
          <text x={top.x} y={top.y - 10} textAnchor="middle" fontSize={11} fill="var(--ink)" fontWeight={600}>
            Polish-without-check
          </text>
          <text x={bl.x - 6} y={bl.y + 22} textAnchor="start" fontSize={11} fill="var(--ink)" fontWeight={600}>
            Iterate-without-verify
          </text>
          <text x={br.x + 6} y={bl.y + 22} textAnchor="end" fontSize={11} fill="var(--ink)" fontWeight={600}>
            Verify-without-iterate
          </text>
        </svg>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <RiskCornerRow
            label="Polish-without-check"
            description="Polished artifact output received zero verification turns. The Anthropic risk pattern."
            value={position.polish_without_check}
            prev={prev?.polish_without_check}
          />
          <RiskCornerRow
            label="Iterate-without-verify"
            description="Multiple iteration rounds but no external verification before merge."
            value={position.iterate_without_verify}
            prev={prev?.iterate_without_verify}
          />
          <RiskCornerRow
            label="Verify-without-iterate"
            description="Verified once, shipped first draft anyway. Sanity-check becomes rubber-stamp."
            value={position.verify_without_iterate}
            prev={prev?.verify_without_iterate}
          />
        </div>
      </div>
    </section>
  );
}

function RiskCornerRow({
  label,
  description,
  value,
  prev,
}: {
  label: string;
  description: string;
  value: number;
  prev?: number;
}) {
  const delta = prev !== undefined ? value - prev : undefined;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong style={{ fontSize: 14 }}>{label}</strong>
        <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 14, color: "var(--ink)" }}>
          {fmtPct(value)}
          {delta !== undefined && (
            <span
              style={{
                marginLeft: 10,
                fontSize: 11,
                color: delta < 0 ? "var(--positive)" : delta > 0 ? "var(--danger)" : "var(--mute)",
              }}
            >
              {delta > 0 ? "+" : ""}{(delta * 100).toFixed(0)}pp
            </span>
          )}
        </span>
      </div>
      <div style={{ marginTop: 6, height: 6, background: "var(--rule-soft)", borderRadius: 1 }}>
        <div style={{ width: fmtPct(value), height: "100%", background: "var(--accent)", borderRadius: 1 }} />
      </div>
      <div style={{ marginTop: 5, fontSize: 11, color: "var(--mute)", lineHeight: 1.55 }}>{description}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Diffusion                                                           */
/* ------------------------------------------------------------------ */

export function DiffusionBlock({ edges }: { edges: FluencyDiffusionEdge[] }) {
  return (
    <section className="insights-section">
      <div className="subsection-head">
        <h2>
          <span className="section-letter">C</span> Pattern diffusion
        </h2>
        <span className="kicker">seeder → adopters · 7-day window</span>
      </div>
      <p style={{ marginTop: 0, marginBottom: 18, fontSize: 13, color: "var(--mute)", maxWidth: 720 }}>
        When one engineer&apos;s habit appeared in another&apos;s transcripts within seven days. This is the
        team-only insight no individual scorecard can produce — it lets you see how practice <em>moves</em>.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
          gap: 18,
        }}
      >
        {edges.map((edge) => {
          const axis = FLUENCY_AXIS_BY_ID[edge.axis];
          return (
            <article
              key={edge.axis + edge.seeder.id}
              style={{
                border: "1px solid var(--rule)",
                background: "var(--paper)",
                padding: "16px 18px",
                borderRadius: 2,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <strong style={{ fontSize: 14, color: "var(--ink)" }}>{axis.title}</strong>
                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--mute)" }}>
                  {axis.id}
                </span>
              </div>
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: 11,
                    padding: "4px 10px",
                    background: "var(--accent-soft)",
                    border: "1px solid var(--accent)",
                    borderRadius: 999,
                    color: "var(--accent)",
                    fontWeight: 600,
                  }}
                >
                  {edge.seeder.name} seeded
                </span>
                <span style={{ color: "var(--mute)", fontSize: 14 }}>→</span>
                {edge.adopters.map((a) => (
                  <span
                    key={a.id}
                    style={{
                      fontSize: 11,
                      padding: "4px 10px",
                      background: "var(--paper)",
                      border: "1px solid var(--rule)",
                      borderRadius: 999,
                      color: "var(--ink-soft)",
                    }}
                    title={`first demonstrated ${a.first_demonstrated}`}
                  >
                    {a.name}
                  </span>
                ))}
              </div>
              <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12, color: "var(--mute)", lineHeight: 1.55 }}>
                {edge.evidence_hint}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Norms drift                                                         */
/* ------------------------------------------------------------------ */

const STATUS_LABEL: Record<FluencyNormsTrajectory["status"], string> = {
  "emerging-norm": "Emerging norm",
  "established-norm": "Established",
  fading: "Fading",
  "pre-norm": "Pre-norm",
  stable: "Stable",
};

const STATUS_COLOR: Record<FluencyNormsTrajectory["status"], string> = {
  "emerging-norm": "var(--positive)",
  "established-norm": "var(--accent)",
  fading: "var(--danger)",
  "pre-norm": "var(--warning)",
  stable: "var(--mute)",
};

export function NormsDriftBlock({ trajectories }: { trajectories: FluencyNormsTrajectory[] }) {
  return (
    <section className="insights-section">
      <div className="subsection-head">
        <h2>
          <span className="section-letter">D</span> Norms drift
        </h2>
        <span className="kicker">5-week rolling</span>
      </div>
      <p style={{ marginTop: 0, marginBottom: 18, fontSize: 13, color: "var(--mute)", maxWidth: 720 }}>
        Demonstrated-rate per axis over the last five ISO weeks. Crossing 50% = becoming a team norm.
        Drifting below 30% = fading practice. Stable + zero = an opportunity worth naming explicitly.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 14,
        }}
      >
        {trajectories.map((t) => (
          <TrajectoryCard key={t.axis} t={t} />
        ))}
      </div>
    </section>
  );
}

function TrajectoryCard({ t }: { t: FluencyNormsTrajectory }) {
  const axis = FLUENCY_AXIS_BY_ID[t.axis];
  const w = 280;
  const h = 70;
  const stepX = w / Math.max(1, t.weekly_rates.length - 1);
  const points = t.weekly_rates.map((r, i) => `${(i * stepX).toFixed(1)},${(h - r * h).toFixed(1)}`);
  const last = t.weekly_rates[t.weekly_rates.length - 1] ?? 0;
  return (
    <article style={{ border: "1px solid var(--rule)", background: "var(--paper)", padding: "14px 16px", borderRadius: 2 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong style={{ fontSize: 13 }}>{axis.title}</strong>
        <span
          style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: STATUS_COLOR[t.status],
            fontWeight: 700,
          }}
        >
          {STATUS_LABEL[t.status]}
        </span>
      </div>
      <svg width={w} height={h + 18} style={{ display: "block", marginTop: 6 }}>
        <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke="var(--rule-soft)" strokeDasharray="3 3" />
        <polyline points={points.join(" ")} fill="none" stroke={STATUS_COLOR[t.status]} strokeWidth={1.5} />
        {t.weekly_rates.map((r, i) => (
          <circle
            key={i}
            cx={i * stepX}
            cy={h - r * h}
            r={i === t.weekly_rates.length - 1 ? 4 : 2.5}
            fill={STATUS_COLOR[t.status]}
          />
        ))}
        {t.weeks.map((wk, i) => (
          <text
            key={wk}
            x={i * stepX}
            y={h + 14}
            textAnchor={i === 0 ? "start" : i === t.weeks.length - 1 ? "end" : "middle"}
            fontSize={9}
            fill="var(--mute)"
            fontFamily="JetBrains Mono, monospace"
          >
            {wk}
          </text>
        ))}
      </svg>
      <div style={{ marginTop: 4, fontSize: 11, color: "var(--mute)" }}>
        Latest: <strong style={{ color: "var(--ink)" }}>{fmtPct(last)}</strong> · axis {t.axis}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/*  Highlights                                                          */
/* ------------------------------------------------------------------ */

export function HighlightsBlock({ highlights }: { highlights: FluencyHighlight[] }) {
  const published = highlights.filter((h) => h.published);
  if (published.length === 0) return null;
  return (
    <section className="insights-section">
      <div className="subsection-head">
        <h2>
          <span className="section-letter">E</span> Highlight reel
        </h2>
        <span className="kicker">opt-in publications · this week</span>
      </div>
      <p style={{ marginTop: 0, marginBottom: 18, fontSize: 13, color: "var(--mute)", maxWidth: 720 }}>
        Moments engineers chose to share with the team. Negative observations are never publishable; the highlight
        reel is for recognition, not for surveillance.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        {published.map((h) => {
          const axis = FLUENCY_AXIS_BY_ID[h.axis];
          return (
            <article
              key={h.session_id + h.axis}
              style={{
                background: "var(--paper)",
                border: "1px solid var(--rule)",
                padding: "14px 16px",
                borderRadius: 2,
                position: "relative",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <strong style={{ fontSize: 13 }}>{h.member_name}</strong>
                <span
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 10,
                    color: "var(--mute)",
                  }}
                >
                  {h.axis} · {axis.title}
                </span>
              </div>
              <blockquote
                style={{
                  margin: "10px 0 8px",
                  padding: "10px 12px",
                  background: "var(--bg)",
                  borderLeft: "3px solid var(--accent)",
                  fontFamily: "Instrument Serif, serif",
                  fontSize: 16,
                  lineHeight: 1.5,
                  fontStyle: "italic",
                }}
              >
                &ldquo;{h.quote}&rdquo;
              </blockquote>
              <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "var(--mute)" }}>
                {h.date} · {AGENT_SOURCE_LABEL[h.source]} · session {h.session_id.slice(0, 8)}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Surface mix                                                         */
/* ------------------------------------------------------------------ */

export function SurfaceMixBlock({ mix }: { mix: Record<AgentSourceKey, number> }) {
  const entries = (Object.entries(mix) as Array<[AgentSourceKey, number]>)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  return (
    <section className="insights-section">
      <div className="subsection-head">
        <h2>
          <span className="section-letter">F</span> Cross-agent surface mix
        </h2>
        <span className="kicker">where your team works this week</span>
      </div>
      <p style={{ marginTop: 0, marginBottom: 14, fontSize: 13, color: "var(--mute)", maxWidth: 720 }}>
        Fluency is observed across every agent your team registers — Claude Code, Codex CLI, Gemini CLI, and any
        future source. Per-axis ratings carry a source breakdown so you can see <em>where</em> a behavior shows up
        or disappears.
      </p>
      <div className="goal-mix-strip" style={{ height: 26 }}>
        {entries.map(([k, v], i) => (
          <div
            key={k}
            className="goal-mix-seg"
            style={{
              width: fmtPct(v),
              background: SOURCE_COLOR[k],
              color: "white",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.04em",
              borderRight: i < entries.length - 1 ? "1px solid rgba(255,255,255,0.25)" : "none",
            }}
            title={`${AGENT_SOURCE_LABEL[k]} — ${fmtPct(v)}`}
          >
            {v > 0.08 ? AGENT_SOURCE_LABEL[k] : ""}
          </div>
        ))}
      </div>
      <div className="goal-mix-legend" style={{ marginTop: 12 }}>
        {entries.map(([k, v]) => (
          <span key={k}>
            <span className="stacked-bar-legend-swatch" style={{ background: SOURCE_COLOR[k], width: 10, height: 10 }} />
            {AGENT_SOURCE_LABEL[k]} <strong>{fmtPct(v)}</strong>
          </span>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Norm proposal                                                       */
/* ------------------------------------------------------------------ */

export function NormProposalBlock({
  proposal,
}: {
  proposal: TeamFluencyReport["norm_proposal"];
}) {
  const axis = FLUENCY_AXIS_BY_ID[proposal.axis];
  return (
    <section
      style={{
        marginTop: 36,
        padding: "26px 30px",
        background: "var(--accent-soft)",
        border: "2px solid var(--accent)",
        borderRadius: 4,
      }}
    >
      <div className="pulse-tile-label" style={{ color: "var(--accent)" }}>
        Proposed team norm
      </div>
      <h3
        style={{
          fontFamily: "Instrument Serif, serif",
          fontSize: 30,
          lineHeight: 1.2,
          letterSpacing: "-0.01em",
          margin: "8px 0 8px",
          color: "var(--ink)",
        }}
      >
        {proposal.headline}
      </h3>
      <div style={{ marginBottom: 12, fontSize: 11, fontFamily: "JetBrains Mono, monospace", color: "var(--mute)" }}>
        Anchored on {proposal.axis} · {axis.title}
      </div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--ink-soft)", maxWidth: 760 }}>
        {proposal.rationale}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Privacy strip                                                       */
/* ------------------------------------------------------------------ */

export function PrivacyStrip() {
  return (
    <div
      style={{
        marginTop: 36,
        padding: "14px 18px",
        background: "var(--paper)",
        border: "1px solid var(--rule)",
        fontSize: 12,
        color: "var(--ink-soft)",
        lineHeight: 1.6,
        borderRadius: 2,
      }}
    >
      <strong>Privacy.</strong> This page is the <em>manager view</em>. It shows aggregate distributions, anonymised
      diffusion edges, and opt-in highlights. Per-engineer scorecards (with their own evidence quotes and growth axes)
      live at <code>/fluency/me</code> and are visible only to the engineer in question. Two database surfaces enforce
      the split — <code>fluency_observations</code> (private, indexed by member) and <code>fluency_team_aggregate</code>
      (the only thing this page reads from).
    </div>
  );
}

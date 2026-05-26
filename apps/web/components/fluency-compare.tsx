/**
 * Side-by-side renderer for the two fluency methods over identical data.
 *
 * Left column: Fleetlens 3/4/4 taxonomy, deterministic prose, Risk Triangle.
 * Right column: Anthropic 2/6/3 taxonomy, LLM-written prose, surfaces line.
 * Bottom strip: explicit diff — which axes overlap, which are unique to
 * each, and the per-axis rating delta where there's a conceptual match.
 */

import { Fluency } from "@claude-lens/entries";
type FluencyScorecard = Fluency.FluencyScorecard;
type AnthropicScorecard = Fluency.AnthropicScorecard;
type FluencyAxisId = Fluency.FluencyAxisId;
type AnthropicAxisId = Fluency.AnthropicAxisId;
type FluencyRating = Fluency.FluencyRating;
const FLUENCY_AXIS_BY_ID = Fluency.FLUENCY_AXIS_BY_ID;
const ANTHROPIC_AXIS_BY_ID = Fluency.ANTHROPIC_AXIS_BY_ID;

const glyph = (r: FluencyRating) => r === "+" ? "[+]" : r === "~" ? "[~]" : r === "-" ? "[-]" : "[·]";
const tone = (r: FluencyRating) =>
  r === "+" ? "var(--af-success)" :
  r === "~" ? "var(--af-warning)" :
  r === "-" ? "var(--af-danger)" : "var(--af-text-tertiary)";

/** Conceptual mapping between the two taxonomies. null on either side =
 *  "this axis is unique to that method." */
const AXIS_MAP: Array<{ fl: FluencyAxisId | null; anth: AnthropicAxisId | null; note: string }> = [
  { fl: "D1",  anth: "A_consult_approach",       note: "Plan-gating ≈ consulting on approach" },
  { fl: "D2",  anth: "A_clarify_goals",          note: "Scoping ≈ clarifying goals" },
  { fl: "D3",  anth: null,                       note: "Reviewer-type matching is Fleetlens-specific (coding agents)" },
  { fl: "De1", anth: null,                       note: "Context shoring is Fleetlens-specific (file refs in opening turn)" },
  { fl: "De2", anth: "A_specify_format",         note: "Output shape ≈ specify format" },
  { fl: "De3", anth: null,                       note: "Constraint surfacing is Fleetlens-specific" },
  { fl: "De4", anth: "A_build_iteratively",      note: "Iterative refinement — same axis, different label" },
  { fl: "Di1", anth: "A_check_facts",            note: "Skeptical review ≈ check facts" },
  { fl: "Di2", anth: null,                       note: "Verify-at-boundary is Fleetlens-specific (PR / test discipline)" },
  { fl: "Di3", anth: null,                       note: "Rollback discipline is Fleetlens-specific" },
  { fl: "Di4", anth: "A_recognize_context",      note: "Context correction ≈ recognise context" },
  { fl: null,  anth: "A_define_audience",        note: "Anthropic-only: define audience for the output" },
  { fl: null,  anth: "A_communicate_tone",       note: "Anthropic-only: communicate tone / style" },
  { fl: null,  anth: "A_provide_examples",       note: "Anthropic-only: provide examples / references" },
  { fl: null,  anth: "A_set_interaction_style",  note: "Anthropic-only: set interaction style / role" },
  { fl: null,  anth: "A_notice_reasoning",       note: "Anthropic-only: notice reasoning flaws with specific critique" },
];

export function FluencyCompare({
  fleetlens,
  anthropic,
  windowEnd,
  entryCount,
}: {
  fleetlens: FluencyScorecard;
  anthropic: AnthropicScorecard | null;
  windowEnd: string;
  entryCount: number;
}) {
  return (
    <>
      <header
        style={{
          padding: "20px 0 22px",
          borderBottom: "1px solid var(--af-border-subtle)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.18em",
            color: "var(--af-text-tertiary)",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          AI Fluency · Side-by-side · 30-day window ending {windowEnd} · {entryCount} entries
        </div>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          Same data, two scoring methodologies.
        </h1>
        <p
          style={{
            margin: "12px 0 0",
            fontSize: 14,
            lineHeight: 1.6,
            color: "var(--af-text-secondary)",
            maxWidth: 720,
          }}
        >
          The Fleetlens method (left) drops Anthropic&apos;s audience / tone / role axes — they
          rarely fire in coding sessions — and adds plan-gating, reviewer-type matching,
          verify-at-boundary, and rollback discipline that are pivotal for code but invisible in
          chat. The Anthropic-style scorecard (right) is the literal published 11 indicators with
          an LLM-written summary. The score delta is purely methodology.
        </p>
      </header>

      <section
        style={{
          marginTop: 22,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 18,
        }}
        className="flu-compare-cols"
      >
        <ScoreCard
          title="Fleetlens method"
          subtitle="3 / 4 / 4 · deterministic prose · Risk Triangle"
          score={fleetlens.score.numerator}
          max={11}
          summary={fleetlens.summary}
          rows={fleetlens.observations.map((o) => ({
            id: o.axis,
            title: FLUENCY_AXIS_BY_ID[o.axis].title,
            rating: o.rating,
            evidence: o.evidence[0]?.quote ?? null,
          }))}
        />
        <ScoreCard
          title="Anthropic-style"
          subtitle="2 / 6 / 3 · LLM-written prose · 30-day window"
          score={anthropic?.score.numerator ?? 0}
          max={11}
          summary={anthropic?.summary ?? null}
          rows={
            anthropic
              ? anthropic.observations.map((o) => ({
                  id: o.axis,
                  title: ANTHROPIC_AXIS_BY_ID[o.axis].title,
                  rating: o.rating,
                  evidence: o.evidence[0]?.quote ?? null,
                }))
              : []
          }
        />
      </section>

      <DiffStrip fleetlens={fleetlens} anthropic={anthropic} />
    </>
  );
}

function ScoreCard({
  title,
  subtitle,
  score,
  max,
  summary,
  rows,
}: {
  title: string;
  subtitle: string;
  score: number;
  max: number;
  summary: string | null;
  rows: Array<{ id: string; title: string; rating: FluencyRating; evidence: string | null }>;
}) {
  return (
    <article
      style={{
        background: "var(--af-surface)",
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 12,
        padding: "16px 18px 18px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <h2 style={{ fontSize: 16, margin: 0, fontWeight: 600 }}>{title}</h2>
        <div
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: "var(--af-accent)",
            letterSpacing: "-0.01em",
          }}
        >
          {score.toFixed(1)} <span style={{ fontSize: 14, color: "var(--af-text-tertiary)" }}>/ {max}</span>
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--af-text-tertiary)", marginBottom: 12 }}>{subtitle}</div>
      {summary && (
        <p
          style={{
            margin: "0 0 14px",
            fontSize: 12.5,
            lineHeight: 1.6,
            color: "var(--af-text-secondary)",
            padding: "8px 10px",
            background: "var(--background)",
            borderRadius: 6,
          }}
        >
          {summary}
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((r) => (
          <div
            key={r.id}
            style={{
              display: "grid",
              gridTemplateColumns: "44px 1fr",
              gap: 8,
              alignItems: "start",
              padding: "6px 0",
              borderBottom: "1px dashed var(--af-border-subtle)",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: tone(r.rating),
                fontWeight: 600,
              }}
            >
              {glyph(r.rating)}
            </span>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 500 }}>
                <span style={{ fontFamily: "var(--font-mono)", color: "var(--af-text-tertiary)", marginRight: 6, fontSize: 11 }}>{r.id}</span>
                {r.title}
              </div>
              {r.evidence && (
                <div
                  style={{
                    marginTop: 3,
                    fontSize: 11.5,
                    color: "var(--af-text-secondary)",
                    lineHeight: 1.5,
                    fontStyle: "italic",
                  }}
                >
                  &ldquo;{r.evidence.length > 110 ? r.evidence.slice(0, 109) + "…" : r.evidence}&rdquo;
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function DiffStrip({ fleetlens, anthropic }: { fleetlens: FluencyScorecard; anthropic: AnthropicScorecard | null }) {
  const flByAxis = new Map(fleetlens.observations.map((o) => [o.axis as string, o.rating]));
  const anthByAxis = anthropic
    ? new Map(anthropic.observations.map((o) => [o.axis as string, o.rating]))
    : new Map<string, FluencyRating>();

  return (
    <section
      style={{
        marginTop: 22,
        padding: "16px 18px 18px",
        background: "var(--af-info-subtle)",
        border: "1px solid var(--af-info)",
        borderRadius: 12,
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--af-info)",
          fontWeight: 700,
          marginBottom: 6,
        }}
      >
        Where the methods diverge
      </div>
      <h3 style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 600 }}>
        Axis mapping &amp; rating delta
      </h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto auto 1fr auto",
          rowGap: 8,
          columnGap: 12,
          fontSize: 12,
          alignItems: "baseline",
        }}
        className="flu-compare-diff"
      >
        <div style={{ fontWeight: 600, color: "var(--af-text-tertiary)" }}>Fleetlens</div>
        <div style={{ fontWeight: 600, color: "var(--af-text-tertiary)" }}>Anthropic</div>
        <div style={{ fontWeight: 600, color: "var(--af-text-tertiary)" }}>Mapping</div>
        <div style={{ fontWeight: 600, color: "var(--af-text-tertiary)", textAlign: "right" }}>Δ</div>
        {AXIS_MAP.map((m, i) => {
          const flR = m.fl ? flByAxis.get(m.fl) : null;
          const anR = m.anth ? anthByAxis.get(m.anth) : null;
          const delta =
            flR && anR && flR !== anR
              ? `${glyph(flR)} → ${glyph(anR)}`
              : flR && !anR
                ? `${glyph(flR)} → —`
                : !flR && anR
                  ? `— → ${glyph(anR)}`
                  : flR === anR && flR
                    ? "match"
                    : "—";
          return (
            <FragmentRow key={i} flId={m.fl} anId={m.anth} note={m.note} delta={delta} divergent={flR !== anR && !!flR && !!anR} />
          );
        })}
      </div>
    </section>
  );
}

function FragmentRow({
  flId, anId, note, delta, divergent,
}: {
  flId: FluencyAxisId | null;
  anId: AnthropicAxisId | null;
  note: string;
  delta: string;
  divergent: boolean;
}) {
  return (
    <>
      <code style={{ fontSize: 11, color: flId ? "var(--af-text)" : "var(--af-text-tertiary)" }}>
        {flId ?? "—"}
      </code>
      <code style={{ fontSize: 11, color: anId ? "var(--af-text)" : "var(--af-text-tertiary)" }}>
        {anId ?? "—"}
      </code>
      <span style={{ color: "var(--af-text-secondary)" }}>{note}</span>
      <span
        style={{
          textAlign: "right",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: divergent ? "var(--af-warning)" : delta === "match" ? "var(--af-success)" : "var(--af-text-tertiary)",
        }}
      >
        {delta}
      </span>
    </>
  );
}

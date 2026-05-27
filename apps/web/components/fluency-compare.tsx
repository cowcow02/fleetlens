/**
 * Side-by-side renderer for the two fluency methods over identical data.
 *
 * Left column: Fleetlens 3/4/4 taxonomy, deterministic prose, Risk Triangle.
 * Right column: Anthropic 2/6/3 taxonomy, LLM-written prose, surfaces line.
 * Bottom strip: explicit diff — which axes overlap, which are unique to
 * each, and the per-axis rating delta where there's a conceptual match.
 */

import { Fluency } from "@claude-lens/entries";
import { SubagentLaneClient } from "./subagent-lane-client";
import { buildEvidenceHash } from "@/lib/evidence-link";
type FluencyScorecard = Fluency.FluencyScorecard;
type AnthropicScorecard = Fluency.AnthropicScorecard;
type SubagentScorecard = Fluency.SubagentScorecard;
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
  useSubagent,
  initialSubagent,
  windowEnd,
  entryCount,
}: {
  fleetlens: FluencyScorecard;
  anthropic: AnthropicScorecard | null;
  useSubagent?: boolean;
  initialSubagent?: SubagentScorecard | null;
  windowEnd: string;
  entryCount: number;
}) {
  const cols = useSubagent ? 3 : 2;
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
          Same data, {cols === 3 ? "three" : "two"} scoring methodologies.
        </h1>
        <p
          style={{
            margin: "12px 0 0",
            fontSize: 14,
            lineHeight: 1.6,
            color: "var(--af-text-secondary)",
            maxWidth: 740,
          }}
        >
          Both deterministic methods (left two) score from regex over typed Entry fields — fast,
          reproducible, but blind to intent. The subagent lane (right, when enabled) hands the
          raw user-message corpus to <code>claude -p</code> and lets it score from intent the
          way Anthropic&apos;s own product does. Score gap = pure methodology.
        </p>
      </header>

      <section
        style={{
          marginTop: 22,
          display: "grid",
          gridTemplateColumns: cols === 3 ? "repeat(3, 1fr)" : "1fr 1fr",
          gap: 16,
        }}
        className="flu-compare-cols"
      >
        <ScoreCard
          title="Fleetlens"
          subtitle="3 / 4 / 4 · regex · 30-day"
          score={fleetlens.score.numerator}
          max={11}
          summary={fleetlens.summary}
          rows={fleetlens.observations.map((o) => ({
            id: o.axis,
            title: FLUENCY_AXIS_BY_ID[o.axis].title,
            rating: o.rating,
            evidence: o.evidence[0]
              ? {
                  quote: o.evidence[0].quote,
                  session_id: o.evidence[0].session_id,
                  turn_index: o.evidence[0].turn_index,
                  kind: o.evidence[0].kind,
                }
              : null,
          }))}
        />
        <ScoreCard
          title="Anthropic-style"
          subtitle="2 / 6 / 3 · regex + LLM prose · 30-day"
          score={anthropic?.score.numerator ?? 0}
          max={11}
          summary={anthropic?.summary ?? null}
          rows={
            anthropic
              ? anthropic.observations.map((o) => ({
                  id: o.axis,
                  title: ANTHROPIC_AXIS_BY_ID[o.axis].title,
                  rating: o.rating,
                  evidence: o.evidence[0]
                    ? {
                        quote: o.evidence[0].quote,
                        session_id: o.evidence[0].session_id,
                      }
                    : null,
                }))
              : []
          }
        />
        {useSubagent && <SubagentLaneClient initialScorecard={initialSubagent ?? undefined} />}
      </section>

      {initialSubagent && <SubagentInsights subagent={initialSubagent} />}
      <DiffStrip fleetlens={fleetlens} anthropic={anthropic} />
    </>
  );
}

function SubagentInsights({ subagent }: { subagent: SubagentScorecard }) {
  return (
    <section
      style={{
        marginTop: 16,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
      }}
      className="flu-growth-grid"
    >
      <div
        style={{
          background: "var(--af-success-subtle)",
          border: "1px solid var(--af-success)",
          borderRadius: 10,
          padding: "12px 14px",
        }}
      >
        <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--af-success)", fontWeight: 700 }}>
          Subagent: Strength
        </div>
        <h3 style={{ margin: "4px 0 6px", fontSize: 15, fontWeight: 600 }}>{subagent.insights.strength_title}</h3>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55 }}>{subagent.insights.strength_body}</p>
      </div>
      <div
        style={{
          background: "var(--af-warning-subtle)",
          border: "1px solid var(--af-warning)",
          borderRadius: 10,
          padding: "12px 14px",
        }}
      >
        <div style={{ fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--af-warning)", fontWeight: 700 }}>
          Subagent: Try next
        </div>
        <h3 style={{ margin: "4px 0 6px", fontSize: 15, fontWeight: 600 }}>{subagent.insights.try_next_title}</h3>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55 }}>{subagent.insights.try_next_body}</p>
      </div>
    </section>
  );
}

function ScoreCard({
  title,
  subtitle,
  score,
  max,
  summary,
  rows,
  footer,
}: {
  title: string;
  subtitle: string;
  score: number;
  max: number;
  summary: string | null;
  rows: Array<{
    id: string;
    title: string;
    rating: FluencyRating;
    evidence: {
      quote: string;
      session_id: string | null;
      /** Optional 0-based turn index; produces `#turn-N` deep link. */
      turn_index?: number;
      /** Verbatim quotes link to the source; derived signals don't (no
       *  honest turn to land on). */
      kind?: "verbatim" | "derived";
    } | null;
  }>;
  footer?: string | null;
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
      {footer && (
        <div style={{ marginTop: -8, marginBottom: 10, fontSize: 10, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)" }}>
          {footer}
        </div>
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
              {r.evidence && (() => {
                const ev = r.evidence;
                const text = ev.quote.length > 110 ? ev.quote.slice(0, 109) + "…" : ev.quote;
                const body = (
                  <div
                    style={{
                      marginTop: 3,
                      fontSize: 11.5,
                      color: "var(--af-text-secondary)",
                      lineHeight: 1.5,
                      fontStyle: "italic",
                    }}
                  >
                    &ldquo;{text}&rdquo;
                  </div>
                );
                // Derived signals are observer-generated commentary, not real
                // user turns — leave them unlinked so we don't pretend a
                // turn-anchored deep link exists.
                const linkable = ev.session_id && ev.kind !== "derived";
                if (!linkable) return body;
                const hash = buildEvidenceHash(ev.quote, ev.turn_index);
                return (
                  <a
                    href={`/sessions/${ev.session_id}${hash}`}
                    className="flu-evidence-link"
                    style={{ textDecoration: "none", color: "inherit", display: "block" }}
                  >
                    {body}
                  </a>
                );
              })()}
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

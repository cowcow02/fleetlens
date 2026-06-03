"use client";

import type { ReactNode } from "react";
import type {
  MaturityEvidenceKind,
  MaturityLevel,
  MaturityPath,
  TeamInsightReport,
} from "../../app/team/[slug]/insights/types";
import { CaseStudyCard } from "./v2-case-studies";
import { FingerprintsSection } from "./v1-fingerprints";
import { TrajectoriesSection } from "./v2-trajectories";
import { DiffusionSection } from "./v3-diffusion";
import {
  ActionCardBlock,
  RiskSignalTile,
  PairedMetricRow,
  InvestmentCard,
  OneOnOneCard,
  DemoCard,
} from "./v5-connected";
import {
  V6PhaseSummaryCard,
  V6WorkflowMappingTable,
  V6TicketJourneyCard,
  V6TrendChart,
  V6AllocationRowCard,
  V6CaseStudyCard,
} from "./v6-ticket-flow";

export type BlockCategory =
  | "activity"
  | "outcomes"
  | "harness"
  | "risks"
  | "case-studies"
  | "tickets"
  | "people"
  | "narrative"
  | "growth";

export type BlockTier = "deterministic" | "llm-enriched" | "external-plug-in";

export type DashboardBlock = {
  id: string;
  title: string;
  short_description: string;
  category: BlockCategory;
  tier: BlockTier;
  source_version: string;
  render: (r: TeamInsightReport) => ReactNode;
  // Width in 4-col grid units (1=25%, 2=50%, 3=75%, 4=100%). Legacy 1-12 values
  // are accepted and snapped down to the 4-col scale. Height is content-driven
  // and ignored; the legacy `defaultH` field is kept for older block defs but
  // does nothing — widgets always grow to fit their content.
  defaultW?: number;
  defaultH?: number;
  minW?: number;
  minH?: number;
};

function snapWidth(w: number): number {
  if (w >= 12) return 4;
  if (w >= 8) return 3;
  if (w >= 5) return 2;
  if (w >= 4) return 4;
  if (w >= 3) return 3;
  if (w >= 2) return 2;
  return 1;
}

export function defaultWidthFor(b: DashboardBlock): number {
  return snapWidth(b.defaultW ?? 2);
}

// ─── Small inline render helpers ─────────────────────────────────────────

// Project identities are full canonical cwd paths (e.g.
// /Users/x/conductor/workspaces/claude-lens). The leaf segment is the
// meaningful repo/workspace name; the absolute prefix just overflows the
// label column and collides with the bars. Show the leaf, keep the full path
// as the title tooltip.
function shortProjectLabel(project: string): string {
  const segs = project.replace(/\/+$/, "").split("/").filter(Boolean);
  return segs[segs.length - 1] || project;
}

// Percent-change is meaningless when a project/skill existed in only one of the
// two weeks (division by ~zero produced +1599% / ±100% noise). Render the
// transition instead.
function wowDelta(thisWk: number, lastWk: number, pct: number): { text: string; tone: string } {
  if (lastWk <= 0 && thisWk > 0) return { text: "new", tone: "positive" };
  if (thisWk <= 0 && lastWk > 0) return { text: "gone", tone: "negative" };
  if (thisWk <= 0 && lastWk <= 0) return { text: "—", tone: "" };
  return { text: `${pct > 0 ? "+" : ""}${pct}%`, tone: pct > 0 ? "positive" : pct < 0 ? "negative" : "" };
}

function fmtMin(n: number): string {
  if (n < 60) return `${Math.round(n)}m`;
  const h = Math.floor(n / 60);
  const m = Math.round(n - h * 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const SPARK = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  return values.map((v) => SPARK[Math.min(7, Math.round((v / max) * 7))]).join("");
}

const PURPOSE_COLORS = ["var(--accent)", "var(--positive)", "var(--warning)", "#6b3aa3", "#2a6f97", "var(--ink-soft)"];

// ─── v8 framework-aligned widgets (Q2-2026 Adoption Framework, slide 5) ──

const MATURITY_LABELS: Record<MaturityLevel, string> = {
  L0: "Unaware",
  L1: "Curious",
  L2: "Regular",
  L3: "Integrated",
  L4: "Multiplier",
};

const MATURITY_COLORS: Record<MaturityLevel, string> = {
  L0: "var(--ink-soft)",
  L1: "#a07b3a",
  L2: "#c98a3a",
  L3: "var(--accent)",
  L4: "var(--positive)",
};

const MATURITY_PATH_LABELS: Record<MaturityPath, string> = {
  "L4-builds": "Builds shared toolchain",
  "L4-coaches": "Coaches teammates",
  "L4-orchestrates": "Orchestrates at scale",
  "L3-daily-active": "Daily active",
  "L3-multi-workflow": "Multiple workflows",
  "L3-orchestration-habit": "Orchestration habit",
  "L2-settled-pattern": "Settled patterns",
  "L1-exploring": "Exploring",
};

const EVIDENCE_KIND_LABELS: Record<MaturityEvidenceKind, string> = {
  decisive: "Decisive",
  supporting: "Supporting",
  "near-miss": "Growth edge",
  style: "Style",
};

const EVIDENCE_GLYPH: Record<MaturityEvidenceKind, string> = {
  decisive: "✓",
  supporting: "✓",
  "near-miss": "⊘",
  style: "·",
};

const V8_BLOCKS: DashboardBlock[] = [
  {
    id: "live-active-rate",
    title: "Active rate · 7-day · 30-day",
    short_description: "% of seats active this week and trailing month",
    category: "activity",
    tier: "deterministic",
    source_version: "v8",
    defaultW: 2,
    render: (r) => {
      const a = r.live_extras?.active_rate;
      if (!a) return <div className="live-empty-row">Active-rate data not in this report.</div>;
      const pct7 = a.members_total === 0 ? 0 : Math.round((a.active_7d / a.members_total) * 100);
      const pct30 = a.members_total === 0 ? 0 : Math.round((a.active_30d / a.members_total) * 100);
      const delta7 = a.active_7d - a.active_7d_prev;
      return (
        <div className="wow-tile-row">
          <div className="wow-tile">
            <div className="wow-tile-label">7-day active</div>
            <div className="wow-tile-value">{pct7}%</div>
            <div className={`wow-tile-delta ${delta7 >= 0 ? "positive" : "negative"}`}>
              {a.active_7d}/{a.members_total} members · {delta7 >= 0 ? "+" : ""}{delta7} vs last wk
            </div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">30-day active</div>
            <div className="wow-tile-value">{pct30}%</div>
            <div className="wow-tile-sub">{a.active_30d}/{a.members_total} have used in trailing month</div>
          </div>
        </div>
      );
    },
  },
  {
    id: "live-member-portraits",
    title: "Adoption maturity · per-member portraits",
    short_description:
      "Qualitative L0-L4 portrait per member — observed actions, qualifying paths, growth edges. Style signals shown separately, never used to grade.",
    category: "people",
    tier: "llm-enriched",
    source_version: "v9",
    defaultW: 4,
    render: (r) => {
      const portraits = r.live_extras?.member_portraits;
      if (!portraits || portraits.length === 0) {
        return <div className="live-empty-row">No member portraits in this report.</div>;
      }
      return (
        <>
          <div className="portrait-preamble muted" style={{ marginBottom: 12, fontSize: 13, lineHeight: 1.5 }}>
            Each member is placed on the slide-7 ladder by reading their trailing-30d
            interactions. Numbers below are pulled directly from <code>rich_daily_rollups</code>,{" "}
            <code>day_artifact_signals</code>, and <code>team_skill_catalog</code> — every value is
            auditable. Style observations are shown for context but never grade the level.
          </div>
          <div className="portrait-stack">
            {portraits.map((p) => {
              const { cadence: c, breadth: b, harness: h } = p;
              const harnessFilesTotal =
                h.skills_authored_30d + h.subagents_authored_30d + h.slash_commands_authored_30d;
              return (
                <div key={p.member} className="portrait-card">
                  <header className="portrait-card-head">
                    <div>
                      <div className="portrait-card-name">{p.member}</div>
                      {p.trend && (
                        <div className="portrait-card-trend muted">
                          {p.trend === "ascending"
                            ? "↗ ascending vs last week"
                            : p.trend === "stable"
                              ? "→ stable vs last week"
                              : "↘ declining vs last week"}
                        </div>
                      )}
                    </div>
                    <div className="portrait-card-level-block">
                      <span
                        className="portrait-card-level"
                        style={{ color: MATURITY_COLORS[p.level] }}
                      >
                        {p.level}
                      </span>{" "}
                      <span className="portrait-card-level-label">
                        {MATURITY_LABELS[p.level]}
                      </span>
                    </div>
                  </header>

                  <p className="portrait-card-summary">{p.qualitative_summary}</p>

                  {/* Three-column stat strip — the concrete signals that drove the level */}
                  <div className="portrait-stats">
                    <div className="portrait-stat-col">
                      <div className="portrait-stat-label">Cadence</div>
                      <div className="portrait-stat-primary">
                        {c.active_days_30d}/30 <span className="portrait-stat-unit">active ({c.cadence_pct_30d}%)</span>
                      </div>
                      <div className="portrait-stat-line">
                        {c.active_days_7d}/7 this week
                      </div>
                      <div className="portrait-stat-line">
                        {c.sessions_30d} sessions · 30d
                      </div>
                      <div className="portrait-stat-line muted">
                        {c.sessions_per_active_day_avg}/day avg
                      </div>
                    </div>
                    <div className="portrait-stat-col">
                      <div className="portrait-stat-label">Breadth</div>
                      <div className="portrait-stat-primary">
                        {b.distinct_projects_30d} <span className="portrait-stat-unit">projects · 30d</span>
                      </div>
                      <div className="portrait-stat-line">
                        {b.distinct_skills_30d} distinct skills
                      </div>
                      <div className="portrait-stat-line">
                        {b.distinct_subagent_kinds_30d} sub-agent kind{b.distinct_subagent_kinds_30d === 1 ? "" : "s"}
                      </div>
                      <div className="portrait-stat-line muted">
                        {b.distinct_projects_7d} project{b.distinct_projects_7d === 1 ? "" : "s"} this week
                      </div>
                    </div>
                    <div className="portrait-stat-col">
                      <div className="portrait-stat-label">Harness authorship</div>
                      <div className="portrait-stat-primary">
                        {harnessFilesTotal} <span className="portrait-stat-unit">file{harnessFilesTotal === 1 ? "" : "s"} authored</span>
                      </div>
                      <div className="portrait-stat-line">
                        {h.claudemd_line_delta_30d > 0 ? "+" : ""}{h.claudemd_line_delta_30d} lines · CLAUDE.md
                      </div>
                      <div className="portrait-stat-line">
                        {h.cross_member_adopters_30d} cross-member adopter{h.cross_member_adopters_30d === 1 ? "" : "s"}
                      </div>
                      <div className="portrait-stat-line muted">
                        {h.skills_authored_30d}s · {h.subagents_authored_30d}a · {h.slash_commands_authored_30d}c
                        <span title="skills · sub-agents · slash-commands"> ⓘ</span>
                      </div>
                    </div>
                  </div>

                  {/* Harness category breakdown — only shown when there's actual harness contribution */}
                  {harnessFilesTotal > 0 || h.claudemd_line_delta_30d !== 0 ? (
                    <div className="portrait-harness-grid">
                      <div className="portrait-harness-label">Harness category · 30 days</div>
                      <table className="portrait-harness-table">
                        <tbody>
                          {h.skills_authored_30d > 0 && (
                            <tr>
                              <td className="portrait-harness-cat">User-authored skills</td>
                              <td className="portrait-harness-val">{h.skills_authored_30d} file{h.skills_authored_30d === 1 ? "" : "s"} authored</td>
                            </tr>
                          )}
                          {h.subagents_authored_30d > 0 && (
                            <tr>
                              <td className="portrait-harness-cat">Custom sub-agents</td>
                              <td className="portrait-harness-val">{h.subagents_authored_30d} file{h.subagents_authored_30d === 1 ? "" : "s"} authored</td>
                            </tr>
                          )}
                          {h.slash_commands_authored_30d > 0 && (
                            <tr>
                              <td className="portrait-harness-cat">Slash commands</td>
                              <td className="portrait-harness-val">{h.slash_commands_authored_30d} file{h.slash_commands_authored_30d === 1 ? "" : "s"} authored</td>
                            </tr>
                          )}
                          {h.claudemd_line_delta_30d !== 0 && (
                            <tr>
                              <td className="portrait-harness-cat">CLAUDE.md / AGENTS.md edits</td>
                              <td className="portrait-harness-val">{h.claudemd_line_delta_30d > 0 ? "+" : ""}{h.claudemd_line_delta_30d} lines net</td>
                            </tr>
                          )}
                          {h.cross_member_adopters_30d > 0 && (
                            <tr className="portrait-harness-row-emphasis">
                              <td className="portrait-harness-cat">Adopted by other members</td>
                              <td className="portrait-harness-val">{h.cross_member_adopters_30d} teammate{h.cross_member_adopters_30d === 1 ? "" : "s"} loaded these</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  {p.qualifying_paths.length > 0 && (
                    <div className="portrait-paths">
                      <span className="portrait-paths-label">Why this level:</span>
                      {p.qualifying_paths.map((path) => (
                        <span key={path} className="portrait-path-chip qualifying">
                          {MATURITY_PATH_LABELS[path]}
                        </span>
                      ))}
                      {p.near_miss_paths.map((path) => (
                        <span key={path} className="portrait-path-chip near-miss">
                          ⊘ {MATURITY_PATH_LABELS[path]}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Decisive + supporting + near-miss observations remain — they
                      now read as captions next to the concrete numbers above */}
                  {(["decisive", "supporting", "near-miss"] as MaturityEvidenceKind[]).map(
                    (kind) => {
                      const items = p.evidence.filter((e) => e.kind === kind);
                      if (items.length === 0) return null;
                      return (
                        <div key={kind} className={`portrait-evidence portrait-evidence-${kind}`}>
                          <div className="portrait-evidence-label">
                            {EVIDENCE_KIND_LABELS[kind]} observations
                          </div>
                          <ul className="portrait-evidence-list">
                            {items.map((e, i) => (
                              <li key={i}>
                                <span className="portrait-evidence-glyph">
                                  {EVIDENCE_GLYPH[kind]}
                                </span>
                                <span>{e.text}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    },
                  )}

                  {p.style_observations.length > 0 && (
                    <div className="portrait-evidence portrait-evidence-style">
                      <div className="portrait-evidence-label">
                        Working-style observations <span className="muted">(not used for grading)</span>
                      </div>
                      <ul className="portrait-evidence-list">
                        {p.style_observations.map((s, i) => (
                          <li key={i}>
                            <span className="portrait-evidence-glyph">·</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      );
    },
  },
  {
    id: "live-maturity-mix",
    title: "Adoption maturity · L0–L4 mix",
    short_description: "Q2-2026 Adoption Framework signature ladder — count per maturity level",
    category: "growth",
    tier: "deterministic",
    source_version: "v8",
    defaultW: 4,
    render: (r) => {
      const m = r.live_extras?.maturity_mix;
      if (!m) return <div className="live-empty-row">Maturity classification not in this report.</div>;
      const total = (Object.values(m.distribution) as number[]).reduce((s, n) => s + n, 0);
      const levels: MaturityLevel[] = ["L0", "L1", "L2", "L3", "L4"];
      return (
        <>
          <div className="delegation-depth-bar" style={{ marginBottom: 12 }}>
            {levels.map((lvl) => {
              const count = m.distribution[lvl] ?? 0;
              const pct = total === 0 ? 0 : (count / total) * 100;
              if (pct === 0) return null;
              return (
                <div
                  key={lvl}
                  className="delegation-depth-seg"
                  style={{ width: `${pct}%`, background: MATURITY_COLORS[lvl] }}
                  title={`${lvl} ${MATURITY_LABELS[lvl]}: ${count}`}
                >
                  {lvl} · {count}
                </div>
              );
            })}
          </div>
          <table className="wow-table" style={{ marginTop: 6 }}>
            <thead>
              <tr><th>Member</th><th>Level</th><th>Evidence</th></tr>
            </thead>
            <tbody>
              {m.classifications.map((c) => (
                <tr key={c.member}>
                  <td className="proj-name">{c.member}</td>
                  <td>
                    <span style={{ color: MATURITY_COLORS[c.level], fontWeight: 600 }}>
                      {c.level}
                    </span>{" "}
                    <span className="muted">{MATURITY_LABELS[c.level]}</span>
                  </td>
                  <td className="muted">{c.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      );
    },
  },
  {
    id: "live-prs-shipped",
    title: "PRs shipped · WoW + per active engineer",
    short_description: "Throughput signal — total PRs and rate per active engineer this week",
    category: "outcomes",
    tier: "deterministic",
    source_version: "v8",
    defaultW: 2,
    render: (r) => {
      const p = r.live_extras?.prs_shipped;
      if (!p) return <div className="live-empty-row">PR data not in this report.</div>;
      const delta = p.current - p.last_week;
      const ppe = p.per_active_engineer.toFixed(1);
      const ppeDelta = p.per_active_engineer - p.per_active_engineer_last_week;
      return (
        <div className="wow-tile-row">
          <div className="wow-tile">
            <div className="wow-tile-label">PRs shipped</div>
            <div className="wow-tile-value">{p.current}</div>
            <div className={`wow-tile-delta ${delta >= 0 ? "positive" : "negative"}`}>
              {delta >= 0 ? "+" : ""}{delta} vs last wk ({p.last_week})
            </div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Per active engineer</div>
            <div className="wow-tile-value">{ppe}</div>
            <div className={`wow-tile-delta ${ppeDelta >= 0 ? "positive" : "negative"}`}>
              {ppeDelta >= 0 ? "+" : ""}{ppeDelta.toFixed(1)} vs last wk
            </div>
          </div>
        </div>
      );
    },
  },
  {
    id: "live-plan-mode",
    title: "Plan-mode adoption",
    short_description: "Share of active members using plan-mode this week",
    category: "harness",
    tier: "deterministic",
    source_version: "v8",
    defaultW: 2,
    render: (r) => {
      const pm = r.live_extras?.plan_mode;
      if (!pm) return <div className="live-empty-row">Plan-mode data not in this report.</div>;
      const sessionDelta = pm.sessions - pm.sessions_last_week;
      return (
        <div className="wow-tile-row">
          <div className="wow-tile">
            <div className="wow-tile-label">Plan-mode adopters</div>
            <div className="wow-tile-value">{pm.adoption_pct}%</div>
            <div className="wow-tile-sub">{pm.adopters} of active members used plan-mode this week</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Plan-mode sessions</div>
            <div className="wow-tile-value">{pm.sessions}</div>
            <div className={`wow-tile-delta ${sessionDelta >= 0 ? "positive" : "negative"}`}>
              {sessionDelta >= 0 ? "+" : ""}{sessionDelta} vs last wk
            </div>
          </div>
        </div>
      );
    },
  },
];

// ─── BLOCK CATALOG ───────────────────────────────────────────────────────

export const BLOCK_CATALOG: DashboardBlock[] = [
  ...V8_BLOCKS,
  // === ACTIVITY ===
  {
    id: "team-pulse-wow",
    title: "Team pulse · WoW tiles",
    short_description: "Combined agent time, sessions, concurrency peak, parallel-execution minutes — all WoW",
    category: "activity",
    tier: "deterministic",
    source_version: "v2 / v5",
    defaultW: 12,
    defaultH: 5,
    render: (r) => {
      const p = r.variants.wow_pulse;
      return (
        <div className="wow-tile-row">
          <div className="wow-tile">
            <div className="wow-tile-label">Combined agent time</div>
            <div className="wow-tile-value">{p.agent_hours.current.toFixed(1)}h</div>
            <div className={`wow-tile-delta ${(p.agent_hours.delta_pct ?? 0) >= 0 ? "positive" : "negative"}`}>
              {(p.agent_hours.delta_pct ?? 0) >= 0 ? "+" : ""}{p.agent_hours.delta_pct}% vs last wk
            </div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Sessions</div>
            <div className="wow-tile-value">{p.sessions.current}</div>
            <div className={`wow-tile-delta ${(p.sessions.delta_abs ?? 0) >= 0 ? "positive" : "negative"}`}>
              {(p.sessions.delta_abs ?? 0) >= 0 ? "+" : ""}{p.sessions.delta_abs} vs last wk
            </div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Concurrency peak</div>
            <div className="wow-tile-value">{r.volume.concurrency_peak.peak}×</div>
            <div className="wow-tile-sub">on {r.volume.concurrency_peak.date}</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Parallel-execution minutes</div>
            <div className="wow-tile-value">{p.parallel_execution.total_min}m</div>
            <div className={`wow-tile-delta ${p.parallel_execution.total_min_wow_delta_pct >= 0 ? "positive" : "negative"}`}>
              {p.parallel_execution.total_min_wow_delta_pct >= 0 ? "+" : ""}{p.parallel_execution.total_min_wow_delta_pct}% vs last wk
            </div>
          </div>
        </div>
      );
    },
  },
  {
    id: "long-autonomous-texture",
    title: "Long-autonomous turn texture",
    short_description: "Count + total min + longest single (not just a percentage)",
    category: "activity",
    tier: "deterministic",
    source_version: "v2 / v5",
    render: (r) => {
      const p = r.variants.wow_pulse.long_autonomous;
      return (
        <div className="wow-tile-row">
          <div className="wow-tile wide">
            <div className="wow-tile-label">Long-autonomous turns</div>
            <div className="wow-tile-value">{p.count}<span className="pulse-tile-suffix"> · {fmtMin(p.total_min)} total</span></div>
            <div className={`wow-tile-delta ${p.count_wow_delta >= 0 ? "positive" : "negative"}`}>
              {p.count_wow_delta >= 0 ? "+" : ""}{p.count_wow_delta} turns vs last wk · total time {p.total_min_wow_delta_pct >= 0 ? "+" : ""}{p.total_min_wow_delta_pct}%
            </div>
            <div className="wow-tile-sub">longest single {fmtMin(p.max_single_min)}</div>
          </div>
        </div>
      );
    },
  },

  // === OUTCOMES ===
  {
    id: "delegation-depth",
    title: "Delegation depth distribution",
    short_description: "Fully delegated / mid / heavy steering bar + 4-week trends",
    category: "outcomes",
    tier: "deterministic",
    source_version: "v4 / v5",
    render: (r) => {
      const d = r.variants.v4_extras.delegation_depth;
      return (
        <>
          <div className="delegation-headline">{d.headline}</div>
          <div className="delegation-depth-bar">
            <div className="delegation-depth-seg seg-fully" style={{ width: `${d.fully_delegated_pct}%` }}>
              Fully delegated {d.fully_delegated_pct}%
            </div>
            <div className="delegation-depth-seg seg-mid" style={{ width: `${d.mid_delegation_pct}%` }}>
              Mid-delegation {d.mid_delegation_pct}%
            </div>
            <div className="delegation-depth-seg seg-heavy" style={{ width: `${d.heavy_steering_pct}%` }}>
              Heavy steering {d.heavy_steering_pct}%
            </div>
          </div>
          <div className="wow-tile-row" style={{ marginTop: 14 }}>
            <div className="wow-tile">
              <div className="wow-tile-label">4w trend · fully delegated</div>
              <div className="wow-tile-value"><span className="cs-spark">{sparkline(d.trend_fully_delegated_4w)}</span></div>
              <div className="wow-tile-sub">{d.trend_fully_delegated_4w.join(" → ")}%</div>
            </div>
            <div className="wow-tile">
              <div className="wow-tile-label">4w trend · heavy steering</div>
              <div className="wow-tile-value"><span className="cs-spark">{sparkline(d.trend_heavy_steering_4w)}</span></div>
              <div className="wow-tile-sub">{d.trend_heavy_steering_4w.join(" → ")}%</div>
            </div>
          </div>
        </>
      );
    },
  },
  {
    id: "augmentation-automation-flip",
    title: "Augmentation ↔ automation",
    short_description: "This week's mix + Anthropic Jan 2026 industry baseline comparison",
    category: "outcomes",
    tier: "deterministic",
    source_version: "v3",
    render: (r) => {
      const f = r.variants.v3_extras.flip;
      return (
        <>
          <div className="flip-bar">
            <div className="flip-seg flip-augmentation" style={{ width: `${f.augmentation_pct_this_week}%` }}>
              Augmentation {f.augmentation_pct_this_week}%
            </div>
            <div className="flip-seg flip-automation" style={{ width: `${f.automation_pct_this_week}%` }}>
              Automation {f.automation_pct_this_week}%
            </div>
          </div>
          <table className="wow-table" style={{ marginTop: 12 }}>
            <thead><tr><th>Week</th><th>Aug.</th><th>Auto.</th></tr></thead>
            <tbody>
              {f.trend_this_team.map((t) => (
                <tr key={t.week_monday}>
                  <td className="proj-name">{t.week_monday}</td>
                  <td>{t.augmentation_pct}%</td>
                  <td>{t.automation_pct}%</td>
                </tr>
              ))}
              <tr style={{ background: "color-mix(in srgb, var(--mute) 8%, var(--paper))" }}>
                <td className="muted">Anthropic Jan 2026</td>
                <td className="muted">{f.industry_baseline_jan_2026.augmentation_pct}%</td>
                <td className="muted">{f.industry_baseline_jan_2026.automation_pct}%</td>
              </tr>
            </tbody>
          </table>
        </>
      );
    },
  },
  {
    id: "purpose-mix-bar",
    title: "Purpose mix · bar chart",
    short_description: "Goal-category share with WoW pp deltas",
    category: "outcomes",
    tier: "llm-enriched",
    source_version: "v4",
    render: (r) => {
      const goals = r.variants.wow_pulse.goal_mix;
      const max = Math.max(...goals.map((g) => g.share_pct), 1);
      return (
        <div className="bar-chart">
          {goals.map((g, i) => (
            <div key={g.category} className="bar-chart-row">
              <div className="bar-chart-label">{g.category}</div>
              <div className="bar-chart-track">
                <div className={`bar-chart-fill purpose-color-${i % 6}`} style={{ width: `${(g.share_pct / max) * 100}%`, background: PURPOSE_COLORS[i % 6] }}>
                  <span className="bar-chart-fill-value">{g.share_pct}%</span>
                </div>
              </div>
              <div className={`bar-chart-delta ${g.delta_pp > 0 ? "positive" : g.delta_pp < 0 ? "negative" : ""}`}>
                {g.delta_pp > 0 ? "+" : ""}{g.delta_pp}pp
              </div>
            </div>
          ))}
        </div>
      );
    },
  },
  {
    id: "per-project-time-bars",
    title: "Per-project time · paired bars",
    short_description: "This week vs last week hours per project",
    category: "outcomes",
    tier: "deterministic",
    source_version: "v4",
    render: (r) => {
      // Only projects active this week — a row that was busy last week but
      // idle this week is just noise in a "this vs last" read.
      const projects = r.variants.wow_pulse.project_time.filter((p) => p.hours_this_week > 0);
      const max = Math.max(...projects.flatMap((p) => [p.hours_this_week, p.hours_last_week]), 1);
      return (
        <div className="bar-chart paired-bar-chart">
          {projects.map((p) => {
            const d = wowDelta(p.hours_this_week, p.hours_last_week, p.delta_pct);
            return (
            <div key={p.project} className="paired-bar-row">
              <div className="bar-chart-label"><code title={p.project}>{shortProjectLabel(p.project)}</code></div>
              <div className="paired-bar-tracks">
                <div className="paired-bar-track">
                  <div className="paired-bar-fill this-week" style={{ width: `${(p.hours_this_week / max) * 100}%` }}>
                    <span className="paired-bar-fill-value">{p.hours_this_week.toFixed(1)}h</span>
                  </div>
                </div>
                <div className="paired-bar-track">
                  <div className="paired-bar-fill last-week" style={{ width: `${(p.hours_last_week / max) * 100}%` }}>
                    <span className="paired-bar-fill-value">{p.hours_last_week.toFixed(1)}h</span>
                  </div>
                </div>
              </div>
              <div className={`bar-chart-delta ${d.tone}`}>{d.text}</div>
            </div>
            );
          })}
          <div className="paired-bar-legend">
            <span><span className="paired-bar-swatch this-week" /> This week</span>
            <span><span className="paired-bar-swatch last-week" /> Last week</span>
          </div>
        </div>
      );
    },
  },
  {
    id: "economic-primitives-table",
    title: "Economic Index primitives · per session",
    short_description: "Purpose / autonomy / success / complexity / skill per opted-in session (Anthropic Jan 2026)",
    category: "outcomes",
    tier: "llm-enriched",
    source_version: "v3",
    render: (r) => (
      <table className="wow-table primitives-table">
        <thead>
          <tr>
            <th>Session</th><th>Purpose</th><th>Autonomy</th><th>Success</th><th>Complexity</th><th>Skill req.</th>
          </tr>
        </thead>
        <tbody>
          {r.variants.case_studies.map((cs) => {
            const ep = cs.economic_primitives;
            if (!ep) return null;
            return (
              <tr key={cs.id}>
                <td><strong>{cs.author}</strong> <span className="muted">{cs.date}</span></td>
                <td>{ep.purpose}</td>
                <td className="primitives-cell">{ep.ai_autonomy}/5</td>
                <td className="primitives-cell">{ep.task_success}/5</td>
                <td className="primitives-cell">{ep.task_complexity}/5</td>
                <td className="primitives-cell">{ep.skill_level_required}/5</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    ),
  },

  // === HARNESS ===
  {
    id: "skill-diffusion-arrows",
    title: "Skill diffusion · arrow visualization",
    short_description: "From-member → to-member arrows for cross-member skill pickups",
    category: "harness",
    tier: "deterministic",
    source_version: "v4",
    defaultW: 6,
    defaultH: 6,
    render: (r) => (
      <div className="diffusion-arrows">
        {r.skills_harness.skill_diffusion_events.map((e, i) => (
          <div key={i} className="diffusion-arrow-row">
            <div className="diffusion-arrow-member origin">{e.from_member}</div>
            <div className="diffusion-arrow-line">
              <div className="diffusion-arrow-shaft" />
              <div className="diffusion-arrow-head" />
              <div className="diffusion-arrow-skill"><code>{e.skill}</code></div>
              <div className="diffusion-arrow-date">{e.date}</div>
            </div>
            <div className="diffusion-arrow-member target">{e.to_member}</div>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "user-authored-skills-bars",
    title: "User-authored skills · adoption bars",
    short_description: "Per-skill: who originated + adoption count + total uses",
    category: "harness",
    tier: "deterministic",
    source_version: "v4",
    render: (r) => {
      const skills = r.skills_harness.user_authored_skills;
      const maxUses = Math.max(...skills.map((x) => x.uses), 1);
      return (
        <div className="skill-adoption-list">
          {skills.map((s) => {
            const adoptionPct = (s.adopters / r.members_total) * 100;
            return (
              <div key={s.name} className="skill-adoption-row">
                <div className="skill-adoption-meta">
                  <code className="skill-adoption-name">{s.name}</code>
                  <span className="skill-adoption-origin">by <strong>{s.originated_by}</strong></span>
                </div>
                <div className="skill-adoption-bars">
                  <div className="skill-adoption-bar-label">Adoption</div>
                  <div className="skill-adoption-bar-track">
                    <div className="skill-adoption-bar-fill adopters" style={{ width: `${adoptionPct}%` }}>
                      <span className="skill-adoption-bar-value">{s.adopters} of {r.members_total} members</span>
                    </div>
                  </div>
                  <div className="skill-adoption-bar-label">Uses</div>
                  <div className="skill-adoption-bar-track">
                    <div className="skill-adoption-bar-fill uses" style={{ width: `${(s.uses / maxUses) * 100}%` }}>
                      <span className="skill-adoption-bar-value">×{s.uses}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      );
    },
  },
  {
    id: "skill-usage-wow-bars",
    title: "Skill usage · paired bars (WoW)",
    short_description: "Top skills with this-week vs last-week paired horizontal bars",
    category: "harness",
    tier: "deterministic",
    source_version: "v4",
    render: (r) => {
      // Only skills used this week — dropping last-week-only rows keeps the
      // WoW read focused on what's actually in play now.
      const skills = r.variants.wow_pulse.skill_usage.filter((s) => s.uses_this_week > 0);
      const max = Math.max(...skills.flatMap((s) => [s.uses_this_week, s.uses_last_week]), 1);
      return (
        <div className="bar-chart paired-bar-chart">
          {skills.map((s) => (
            <div key={s.skill} className="paired-bar-row">
              <div className="bar-chart-label"><code>{s.skill}</code></div>
              <div className="paired-bar-tracks">
                <div className="paired-bar-track">
                  <div className="paired-bar-fill this-week" style={{ width: `${(s.uses_this_week / max) * 100}%` }}>
                    <span className="paired-bar-fill-value">×{s.uses_this_week}</span>
                  </div>
                </div>
                <div className="paired-bar-track">
                  <div className="paired-bar-fill last-week" style={{ width: `${(s.uses_last_week / max) * 100}%` }}>
                    <span className="paired-bar-fill-value">×{s.uses_last_week}</span>
                  </div>
                </div>
              </div>
              <div className={`bar-chart-delta ${s.delta > 0 ? "positive" : s.delta < 0 ? "negative" : ""}`}>
                {s.delta > 0 ? "+" : ""}{s.delta}
              </div>
            </div>
          ))}
        </div>
      );
    },
  },
  {
    id: "harness-engineering",
    title: "Harness engineering tiles",
    short_description: "Working-memory budget · cache hit rate · tool success · trajectory eval",
    category: "harness",
    tier: "deterministic",
    source_version: "v3",
    render: (r) => {
      const h = r.variants.v3_extras.harness_engineering;
      return (
        <div className="wow-tile-row">
          <div className="wow-tile">
            <div className="wow-tile-label">Working-memory budget</div>
            <div className="wow-tile-value">{h.working_memory_budget.median_pct_used}%</div>
            <div className="wow-tile-sub">{h.working_memory_budget.sessions_over_80pct} sessions ≥80%</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Cache hit rate</div>
            <div className="wow-tile-value">{h.cache_hit_rate_pct}%</div>
            <div className={`wow-tile-delta ${h.cache_hit_delta_pp >= 0 ? "positive" : "negative"}`}>
              {h.cache_hit_delta_pp >= 0 ? "+" : ""}{h.cache_hit_delta_pp}pp vs last wk
            </div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Tool-call success</div>
            <div className="wow-tile-value">{h.tool_call_efficiency.successful_calls_pct}%</div>
            <div className="wow-tile-sub">{h.tool_call_efficiency.median_tools_per_outcome_unit} median tools/ship</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Trajectory</div>
            <div className="wow-tile-value">{h.trajectory_eval.sessions_with_steady_progress}<span className="pulse-tile-suffix"> steady</span></div>
            <div className="wow-tile-sub">{h.trajectory_eval.sessions_with_unforced_loops} loops · {h.trajectory_eval.sessions_with_premature_completion} premature</div>
          </div>
        </div>
      );
    },
  },

  // === RISKS ===
  {
    id: "risk-signals",
    title: "Risk signals · 3 monitored bands",
    short_description: "Babysitting / Expertise gap / Wrong-tool with thresholds + actions",
    category: "risks",
    tier: "deterministic",
    source_version: "v5",
    defaultW: 12,
    defaultH: 9,
    render: (r) => (
      <div className="risk-tile-row">
        {r.variants.v5_extras.actionables.risk_signals.map((s) => <RiskSignalTile key={s.name} signal={s} />)}
      </div>
    ),
  },
  {
    id: "dora-attribution",
    title: "DORA with attribution",
    short_description: "4 classic metrics + AI-assisted vs human-authored split (external integration)",
    category: "risks",
    tier: "external-plug-in",
    source_version: "v5",
    render: (r) => {
      const d = r.variants.v5_extras.dora_actual;
      return (
        <table className="wow-table">
          <thead><tr><th>Metric</th><th>Current</th><th>AI-assisted</th><th>Human</th></tr></thead>
          <tbody>
            <tr><td className="proj-name">Deployment frequency</td><td>{d.deployment_frequency.current.toFixed(1)}/day</td><td>{d.deployment_frequency.ai_assisted_share_pct}% of deploys</td><td className="muted">—</td></tr>
            <tr><td className="proj-name">Lead time</td><td>{fmtMin(d.lead_time_min.current)}</td><td>{fmtMin(d.lead_time_min.ai_assisted_median)}</td><td>{fmtMin(d.lead_time_min.human_authored_median)}</td></tr>
            <tr><td className="proj-name">CFR</td><td>{d.change_failure_rate_pct.current}%</td><td>{d.change_failure_rate_pct.ai_assisted}%</td><td>{d.change_failure_rate_pct.human_authored}%</td></tr>
            <tr><td className="proj-name">MTTR</td><td>{fmtMin(d.mttr_min.current)}</td><td>{fmtMin(d.mttr_min.ai_assisted_median)}</td><td>{fmtMin(d.mttr_min.human_authored_median)}</td></tr>
          </tbody>
        </table>
      );
    },
  },
  {
    id: "quality-watch",
    title: "Quality watch · conformity, rework, churn, review depth",
    short_description: "Output-quality metrics from context engineering",
    category: "risks",
    tier: "external-plug-in",
    source_version: "v5",
    render: (r) => {
      const q = r.variants.v5_extras.quality_actual;
      return (
        <div className="wow-tile-row">
          <div className="wow-tile">
            <div className="wow-tile-label">Conformity rate</div>
            <div className="wow-tile-value">{q.conformity_rate_pct.current}%</div>
            <div className={`wow-tile-delta ${q.conformity_rate_pct.delta_pp_wow >= 0 ? "positive" : "negative"}`}>{q.conformity_rate_pct.delta_pp_wow >= 0 ? "+" : ""}{q.conformity_rate_pct.delta_pp_wow}pp WoW</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Rework rate</div>
            <div className="wow-tile-value">{q.rework_rate_pct.current}%</div>
            <div className={`wow-tile-delta ${q.rework_rate_pct.delta_pp_wow <= 0 ? "positive" : "negative"}`}>{q.rework_rate_pct.delta_pp_wow >= 0 ? "+" : ""}{q.rework_rate_pct.delta_pp_wow}pp WoW</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">14-day code churn</div>
            <div className="wow-tile-value">{q.code_churn_14d_pct.current}%</div>
            <div className={`wow-tile-delta ${q.code_churn_14d_pct.delta_pp_wow <= 0 ? "positive" : "negative"}`}>{q.code_churn_14d_pct.delta_pp_wow >= 0 ? "+" : ""}{q.code_churn_14d_pct.delta_pp_wow}pp WoW</div>
          </div>
          <div className="wow-tile">
            <div className="wow-tile-label">Review depth</div>
            <div className="wow-tile-value">{q.review_depth_per_pr.current.toFixed(1)}</div>
            <div className={`wow-tile-delta ${q.review_depth_per_pr.delta_pct_wow >= 0 ? "positive" : "negative"}`}>{q.review_depth_per_pr.delta_pct_wow >= 0 ? "+" : ""}{q.review_depth_per_pr.delta_pct_wow}% WoW</div>
          </div>
        </div>
      );
    },
  },

  // === CASE STUDIES ===
  {
    id: "case-studies-all",
    title: "Case studies · all opted-in sessions",
    short_description: "Full case-study cards with timeline minimap, pins, drill, narrative",
    category: "case-studies",
    tier: "llm-enriched",
    source_version: "v2 / v4",
    defaultW: 12,
    defaultH: 20,
    render: (r) => (
      <>
        {r.variants.case_studies.map((cs) => <CaseStudyCard key={cs.id} cs={cs} />)}
      </>
    ),
  },

  // === TICKETS ===
  {
    id: "workflow-mapper",
    title: "Workflow mapper · Linear / Jira / custom statuses",
    short_description: "How raw ticket statuses map to normalized phases",
    category: "tickets",
    tier: "external-plug-in",
    source_version: "v6",
    render: (r) => <V6WorkflowMappingTable rows={r.variants.v6_extras.workflow_mappings} />,
  },
  {
    id: "phase-bottleneck-cards",
    title: "Phase bottleneck cards",
    short_description: "6 phase cards (spec/ready/impl/review/qa/launch) with median time + WoW",
    category: "tickets",
    tier: "external-plug-in",
    source_version: "v6",
    defaultW: 12,
    defaultH: 8,
    render: (r) => {
      const phases = r.variants.v6_extras.phase_summaries;
      const maxScore = Math.max(...phases.map((p) => p.bottleneck_score), 1);
      return (
        <div className="v6-phase-card-grid">
          {phases.map((phase) => <V6PhaseSummaryCard key={phase.phase} phase={phase} maxScore={maxScore} />)}
        </div>
      );
    },
  },
  {
    id: "ticket-live-journeys",
    title: "Ticket live journeys",
    short_description: "Per-ticket phase rails with submitted-session markers + narrative",
    category: "tickets",
    tier: "external-plug-in",
    source_version: "v6",
    defaultW: 12,
    defaultH: 14,
    render: (r) => (
      <>
        {r.variants.v6_extras.ticket_journeys.map((t) => <V6TicketJourneyCard key={t.id} ticket={t} />)}
      </>
    ),
  },
  {
    id: "implementation-window-trend",
    title: "Implementation window compression trend",
    short_description: "Median implementation minutes over recent weeks",
    category: "tickets",
    tier: "external-plug-in",
    source_version: "v6",
    render: (r) => <V6TrendChart rows={r.variants.v6_extras.implementation_trend} />,
  },
  {
    id: "member-phase-allocation",
    title: "Member phase-allocation map",
    short_description: "Per-member time distribution across phases",
    category: "tickets",
    tier: "external-plug-in",
    source_version: "v6",
    render: (r) => (
      <div className="v6-allocation-rows">
        {r.variants.v6_extras.allocation.map((row) => <V6AllocationRowCard key={row.member} row={row} />)}
      </div>
    ),
  },
  {
    id: "v6-case-studies",
    title: "Ticket-anchored case studies",
    short_description: "Why specific tickets compressed or stalled (opt-in)",
    category: "case-studies",
    tier: "llm-enriched",
    source_version: "v6",
    render: (r) => (
      <>
        {r.variants.v6_extras.case_studies.map((c) => <V6CaseStudyCard key={`${c.ticket_id}-${c.title}`} c={c} />)}
      </>
    ),
  },

  // === PEOPLE ===
  {
    id: "member-fingerprints",
    title: "Member fingerprints · per-member portraits",
    short_description: "Signature move + 4-week growth arc per active member",
    category: "people",
    tier: "llm-enriched",
    source_version: "v1",
    render: (r) => <FingerprintsSection r={r} />,
  },
  {
    id: "oneonone-prompts",
    title: "1:1 prompts · per-member",
    short_description: "Concrete prompts for next 1:1s, each anchored to a specific signal",
    category: "people",
    tier: "llm-enriched",
    source_version: "v5",
    defaultW: 12,
    defaultH: 10,
    render: (r) => (
      <div className="oneonone-stack">
        {r.variants.v5_extras.actionables.oneonone_prompts.map((p, i) => <OneOnOneCard key={i} p={p} />)}
      </div>
    ),
  },
  {
    id: "demo-candidates",
    title: "Friday demo candidates",
    short_description: "3 sessions worth a 5-minute team showcase",
    category: "people",
    tier: "llm-enriched",
    source_version: "v5",
    render: (r) => (
      <div className="demo-grid">
        {r.variants.v5_extras.actionables.demo_candidates.map((d, i) => <DemoCard key={i} d={d} />)}
      </div>
    ),
  },

  // === NARRATIVE ===
  {
    id: "hero-takeaway",
    title: "Hero takeaway · single-line callout",
    short_description: "The one thing to walk away with this week",
    category: "narrative",
    tier: "llm-enriched",
    source_version: "v5",
    defaultW: 12,
    defaultH: 4,
    render: (r) => <div className="hero-takeaway">{r.variants.v5_extras.actionables.hero_takeaway}</div>,
  },
  {
    id: "strengths-cards",
    title: "Strengths to lean into",
    short_description: "3 things working + suggested actions",
    category: "narrative",
    tier: "llm-enriched",
    source_version: "v5",
    defaultW: 6,
    defaultH: 10,
    render: (r) => <ActionCardBlock kind="strength" cards={r.variants.v5_extras.actionables.strengths} />,
  },
  {
    id: "dysfunctions-cards",
    title: "Dysfunctions to watch",
    short_description: "3 things needing attention + suggested actions",
    category: "narrative",
    tier: "llm-enriched",
    source_version: "v5",
    defaultW: 6,
    defaultH: 10,
    render: (r) => <ActionCardBlock kind="dysfunction" cards={r.variants.v5_extras.actionables.dysfunctions} />,
  },
  {
    id: "paired-speed-quality",
    title: "Speed + quality paired",
    short_description: "Every speed metric next to its quality counterpart",
    category: "outcomes",
    tier: "external-plug-in",
    source_version: "v5",
    render: (r) => (
      <div className="paired-metric-stack">
        {r.variants.v5_extras.actionables.paired_metrics.map((pm, i) => <PairedMetricRow key={i} pm={pm} />)}
      </div>
    ),
  },
  {
    id: "investments",
    title: "Investments for next week",
    short_description: "6 recommendations derived from this week's data · effort-tagged",
    category: "narrative",
    tier: "llm-enriched",
    source_version: "v5",
    render: (r) => (
      <div className="investment-grid">
        {r.variants.v5_extras.actionables.investments.map((inv, i) => <InvestmentCard key={i} inv={inv} />)}
      </div>
    ),
  },

  // === GROWTH ===
  {
    id: "trajectories-grid",
    title: "Growth trajectories · practice × member matrix",
    short_description: "9 practices × 4 members · 4-week sparklines + WoW deltas",
    category: "growth",
    tier: "llm-enriched",
    source_version: "v1 / v2",
    render: (r) => <TrajectoriesSection r={r} />,
  },
  {
    id: "diffusion-grid",
    title: "Practice diffusion grid · 12 practices × members",
    short_description: "Originator / regular / tried / not-yet across the team",
    category: "growth",
    tier: "llm-enriched",
    source_version: "v1 / v3",
    render: (r) => <DiffusionSection r={r} />,
  },
];

// Group catalog by category (preserves source order)
export const CATEGORY_LABELS: Record<BlockCategory, string> = {
  activity: "Activity & pulse",
  outcomes: "Outcomes & throughput",
  harness: "Harness & skills",
  risks: "Risks & quality",
  "case-studies": "Case studies (opt-in)",
  tickets: "Tickets & lifecycle",
  people: "People & 1:1s",
  narrative: "Narrative & actions",
  growth: "Growth & multi-week",
};

export function groupBlocksByCategory(blocks: DashboardBlock[]): Record<BlockCategory, DashboardBlock[]> {
  const groups: Record<BlockCategory, DashboardBlock[]> = {
    activity: [], outcomes: [], harness: [], risks: [], "case-studies": [], tickets: [], people: [], narrative: [], growth: [],
  };
  for (const b of blocks) groups[b.category].push(b);
  return groups;
}

// Suggested starter set when ?blocks= is empty
export const STARTER_BLOCKS = [
  "hero-takeaway",
  "team-pulse-wow",
  "strengths-cards",
  "dysfunctions-cards",
  "risk-signals",
  "skill-diffusion-arrows",
  "phase-bottleneck-cards",
  "oneonone-prompts",
];

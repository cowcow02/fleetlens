"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { DayDigest as DayDigestType, DaySignals, Entry } from "@claude-lens/entries";
import { OutcomePill } from "./outcome-pill";
import { GoalBar } from "./goal-bar";

const SHAPE_LABELS: Record<string, string> = {
  "spec-review-loop": "Spec-review loop",
  "chunk-implementation": "Chunk implementation",
  "research-then-build": "Research-then-build",
  "reviewer-triad": "Reviewer triad",
  "background-coordinated": "Background-coordinated",
  "solo-continuation": "Solo continuation",
  "solo-design": "Solo design",
  "solo-build": "Solo build",
  "mixed": "Mixed",
};

const FRAME_LABELS: Record<string, string> = {
  "teammate": "<teammate-message>",
  "task-notification": "<task-notification>",
  "local-command-caveat": "<local-command-caveat>",
  "image-attached": "[Image #N]",
  "slash-command": "/command",
  "handoff-prose": "Handoff prose",
};

export function DayDigest({
  digest, entries, aiEnabled, actions,
}: {
  digest: DayDigestType;
  entries: Entry[];
  aiEnabled: boolean;
  /** Optional inline-right cluster (e.g. Generate / Re-roll buttons). */
  actions?: ReactNode;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const fmtDate = new Date(`${digest.key}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric", year: "numeric",
  });
  const hrs = digest.agent_min / 60;
  const timeStr = hrs >= 1 ? `${hrs.toFixed(1)}h` : `${Math.round(digest.agent_min)}m`;

  // Sort entries chronologically (most recent first)
  const sortedEntries = [...entries].sort(
    (a, b) => Date.parse(b.start_iso) - Date.parse(a.start_iso),
  );

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "24px 40px" }}>
      {/* Hero: date + outcome + stats on one row, headline below */}
      <header style={{ marginBottom: 28 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, marginBottom: 8,
          fontSize: 12, color: "var(--af-text-tertiary)", fontWeight: 500,
          flexWrap: "wrap",
        }}>
          <span>{fmtDate}</span>
          <OutcomePill outcome={digest.outcome_day} size="lg" />
          <span style={{ color: "var(--af-text-tertiary)" }}>·</span>
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--af-text-secondary)" }}>
            {timeStr} agent time · {digest.projects.length} project{digest.projects.length === 1 ? "" : "s"} · {digest.shipped.length} PR{digest.shipped.length === 1 ? "" : "s"} shipped
            {digest.concurrency_peak > 1 && ` · peak concurrency ×${digest.concurrency_peak}`}
          </span>
          {actions && (
            <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
              {actions}
            </div>
          )}
        </div>
        {digest.headline ? (
          <h1 style={{
            fontSize: 26, fontWeight: 700, lineHeight: 1.3, letterSpacing: "-0.02em",
            margin: "0 0 8px", maxWidth: 820, color: "var(--af-text)",
          }}>
            {digest.headline}
          </h1>
        ) : (
          <h1 style={{ fontSize: 20, color: "var(--af-text-secondary)", margin: "0 0 14px" }}>
            {aiEnabled ? "No narrative yet — click Regenerate." : `Worked ${timeStr} across ${digest.projects.length} project${digest.projects.length === 1 ? "" : "s"}.`}
          </h1>
        )}
        {digest.day_signature && (
          <p style={{
            margin: "0 0 14px", fontSize: 14, fontStyle: "italic",
            color: "var(--af-text-secondary)", maxWidth: 820, lineHeight: 1.5,
          }}>
            {digest.day_signature}
          </p>
        )}
      </header>

      {/* AI-off nudge */}
      {!aiEnabled && (
        <div style={{
          padding: 14, marginBottom: 24, background: "var(--af-accent-subtle)",
          borderRadius: 8, fontSize: 13, color: "var(--af-text)",
        }}>
          Enable AI features in <a href="/settings" style={{ color: "var(--af-accent)" }}>Settings</a> to see daily narratives.
        </div>
      )}

      {/* "How today worked" — deterministic per-day classification, anchors the narrative below. */}
      {digest.day_signals && <DaySignalsSection signals={digest.day_signals} />}

      {/* Went-well / Friction bands (no panel chrome) */}
      {(digest.what_went_well || digest.what_hit_friction) && (
        <section style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 28,
        }}>
          <Band glyph="✓" color="#48bb78" text={digest.what_went_well} emptyLabel="(smooth)" />
          <Band glyph="⚠" color="#ed8936" text={digest.what_hit_friction} emptyLabel="(no friction)" />
        </section>
      )}

      {/* Narrative */}
      {digest.narrative && (
        <section style={{
          marginBottom: 28, padding: "4px 0",
          fontSize: 15, lineHeight: 1.6, color: "var(--af-text)",
          maxWidth: 760,
        }}>
          {digest.narrative}
        </section>
      )}

      {/* Show-more toggle: by default we keep the page short — only headline,
          bands, narrative are visible. Suggestion + work breakdown + shipped +
          sessions + goal-mix collapse behind this button so the timeline section
          below stays close to the fold. */}
      <div style={{ marginBottom: 18 }}>
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            background: "transparent",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--af-text-secondary)",
            cursor: "pointer",
          }}
        >
          {showDetails ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {showDetails ? "Hide details" : "Show more details"}
        </button>
      </div>

      {showDetails && (<>

      {/* Suggestion */}
      {digest.suggestion && (
        <section style={{
          borderLeft: "3px solid var(--af-accent)", paddingLeft: 16, marginBottom: 32,
        }}>
          <div style={{ fontSize: 11, color: "var(--af-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 6 }}>
            Tomorrow
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, color: "var(--af-text)" }}>
            {digest.suggestion.headline}
          </div>
          <div style={{ fontSize: 13, color: "var(--af-text-secondary)", lineHeight: 1.5, maxWidth: 760 }}>
            {digest.suggestion.body}
          </div>
        </section>
      )}

      {/* Work breakdown */}
      {digest.projects.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <SectionLabel>Work breakdown</SectionLabel>
          <div style={{ display: "grid", gap: 6 }}>
            {digest.projects.map(p => {
              const shippedForProj = digest.shipped.filter(s => s.project === p.display_name);
              return (
                <div key={p.name} style={{
                  display: "grid",
                  gridTemplateColumns: "140px 1fr 56px 72px",
                  gap: 12, alignItems: "center", padding: "6px 0",
                  borderBottom: "1px solid var(--af-border-subtle)",
                  fontSize: 13,
                }}>
                  <span title={p.name} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.display_name}
                  </span>
                  <ShareBar pct={p.share_pct} />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--af-text-tertiary)", textAlign: "right" }}>
                    {p.share_pct.toFixed(0)}%
                  </span>
                  <span style={{ fontSize: 11, color: "var(--af-text-tertiary)", textAlign: "right" }}>
                    {shippedForProj.length > 0 ? `${shippedForProj.length} PR${shippedForProj.length === 1 ? "" : "s"}` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Shipped PRs list */}
      {digest.shipped.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <SectionLabel>Shipped</SectionLabel>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {digest.shipped.map((s, i) => (
              <li key={i} style={{
                padding: "6px 0", fontSize: 13, borderBottom: "1px solid var(--af-border-subtle)",
                display: "flex", gap: 10, alignItems: "baseline",
              }}>
                <span style={{ color: "#48bb78", fontSize: 12 }}>✓</span>
                <span style={{ flex: 1 }}>{s.title}</span>
                <span style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>{s.project}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Sessions — brief_summary as primary, session UUID hidden */}
      {sortedEntries.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <SectionLabel>Sessions · {sortedEntries.length}</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {sortedEntries.map(e => <SessionRow key={e.session_id} entry={e} />)}
          </div>
        </section>
      )}

      {/* Goal mix (footer) */}
      {digest.top_goal_categories.length > 0 && (
        <section style={{ marginTop: 40, paddingTop: 20, borderTop: "1px solid var(--af-border-subtle)" }}>
          <div style={{ fontSize: 11, color: "var(--af-text-tertiary)", marginBottom: 6 }}>
            Goal mix
          </div>
          <GoalBar goals={digest.top_goal_categories} total={digest.agent_min} />
        </section>
      )}

      </>)}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, color: "var(--af-text-tertiary)", textTransform: "uppercase",
      letterSpacing: "0.08em", fontWeight: 600, marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

function Band({ glyph, color, text, emptyLabel }: { glyph: string; color: string; text: string | null; emptyLabel: string }) {
  return (
    <div
      style={{
        fontSize: 14,
        lineHeight: 1.55,
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
      }}
    >
      <span style={{ fontSize: 16, color, lineHeight: 1.4, flexShrink: 0 }}>
        {glyph}
      </span>
      {text ? (
        <span style={{ color: "var(--af-text)" }}>{text}</span>
      ) : (
        <span style={{ color: "var(--af-text-tertiary)", fontStyle: "italic" }}>{emptyLabel}</span>
      )}
    </div>
  );
}

function ShareBar({ pct }: { pct: number }) {
  return (
    <div style={{ height: 6, background: "var(--af-border-subtle)", borderRadius: 99, overflow: "hidden" }}>
      <div style={{
        width: `${Math.min(100, Math.max(0, pct))}%`, height: "100%",
        background: "var(--af-accent)", transition: "width 0.2s",
      }} />
    </div>
  );
}

function DaySignalsSection({ signals }: { signals: DaySignals }) {
  const hasShape = signals.dominant_shape !== null;
  const hasShapeMix = Object.keys(signals.shape_distribution).length > 0;
  const hasSubagentRoles =
    signals.user_authored_subagents_used.length > 0
    || Object.keys(signals.shape_distribution).length > 0;
  const stockSkills = signals.skills_loaded.filter(s => s.origin === "stock");
  const userSkills = signals.skills_loaded.filter(s => s.origin === "user");
  const claudeFrames = signals.prompt_frames.filter(f => f.origin === "claude-feature");
  const personalFrames = signals.prompt_frames.filter(f => f.origin === "personal-habit");
  const cs = signals.comm_style;
  const verbositySum = cs.verbosity_distribution.short + cs.verbosity_distribution.medium
    + cs.verbosity_distribution.long + cs.verbosity_distribution.very_long;
  const steeringSum = cs.steering.interrupts + cs.steering.frustrated + cs.steering.dissatisfied;

  if (!hasShape && !hasShapeMix && stockSkills.length === 0 && userSkills.length === 0
      && signals.user_authored_subagents_used.length === 0
      && claudeFrames.length === 0 && personalFrames.length === 0
      && verbositySum === 0 && cs.external_refs.length === 0 && steeringSum === 0
      && signals.brainstorm_warmup_session_count === 0
      && signals.todo_ops_total === 0 && !signals.plan_mode_used) {
    return null;
  }

  return (
    <section style={{
      marginBottom: 28, padding: "14px 16px", borderRadius: 8,
      background: "var(--af-surface)", border: "1px solid var(--af-border-subtle)",
    }}>
      <div style={{
        fontSize: 10, color: "var(--af-text-tertiary)", textTransform: "uppercase",
        letterSpacing: "0.08em", fontWeight: 600, marginBottom: 10,
      }}>
        How today worked
      </div>

      {hasShape && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", padding: "3px 10px",
            borderRadius: 999, fontSize: 12, fontWeight: 600,
            background: "var(--af-accent-subtle)", color: "var(--af-accent)",
          }}>
            {SHAPE_LABELS[signals.dominant_shape!] ?? signals.dominant_shape}
          </span>
          {hasShapeMix && (
            <span style={{ fontSize: 12, color: "var(--af-text-secondary)", fontFamily: "var(--font-mono)" }}>
              {Object.entries(signals.shape_distribution)
                .sort((a, b) => b[1] - a[1])
                .map(([s, n]) => `${n} ${s}`)
                .join(" · ")}
            </span>
          )}
        </div>
      )}

      {hasSubagentRoles && signals.user_authored_subagents_used.length > 0 && (
        <SignalsRow label="Your subagents">
          {signals.user_authored_subagents_used.slice(0, 4).map(sa => (
            <Chip key={sa.type} title={sa.sample_prompt_preview}>
              {sa.type}{sa.count > 1 ? ` ×${sa.count}` : ""}
            </Chip>
          ))}
        </SignalsRow>
      )}

      {(stockSkills.length > 0 || userSkills.length > 0) && (
        <SignalsRow label="Skills loaded">
          {userSkills.slice(0, 4).map(s => (
            <Chip key={s.skill} tone="user">{s.skill}{s.count > 1 ? ` ×${s.count}` : ""}</Chip>
          ))}
          {stockSkills.slice(0, 4).map(s => (
            <Chip key={s.skill} tone="stock">{s.skill}{s.count > 1 ? ` ×${s.count}` : ""}</Chip>
          ))}
        </SignalsRow>
      )}

      {(claudeFrames.length > 0 || personalFrames.length > 0) && (
        <SignalsRow label="Prompt frames">
          {personalFrames.map(f => (
            <Chip key={f.frame} tone="user">
              {FRAME_LABELS[f.frame] ?? f.frame}{f.count > 1 ? ` ×${f.count}` : ""}
            </Chip>
          ))}
          {claudeFrames.map(f => (
            <Chip key={f.frame} tone="stock">
              {FRAME_LABELS[f.frame] ?? f.frame}{f.count > 1 ? ` ×${f.count}` : ""}
            </Chip>
          ))}
        </SignalsRow>
      )}

      {(verbositySum > 0 || cs.external_refs.length > 0 || steeringSum > 0) && (
        <SignalsRow label="Comm style">
          {verbositySum > 0 && (
            <span style={{ fontSize: 12, color: "var(--af-text-secondary)", fontFamily: "var(--font-mono)" }}>
              {[
                cs.verbosity_distribution.short && `${cs.verbosity_distribution.short} short`,
                cs.verbosity_distribution.medium && `${cs.verbosity_distribution.medium} med`,
                cs.verbosity_distribution.long && `${cs.verbosity_distribution.long} long`,
                cs.verbosity_distribution.very_long && `${cs.verbosity_distribution.very_long} v.long`,
              ].filter(Boolean).join(" · ")}
            </span>
          )}
          {cs.external_refs.length > 0 && (
            <Chip>{cs.external_refs.length} external ref{cs.external_refs.length === 1 ? "" : "s"}</Chip>
          )}
          {cs.steering.interrupts > 0 && <Chip>{cs.steering.interrupts} interrupts</Chip>}
          {cs.steering.sessions_with_mid_run_redirect > 0 && (
            <Chip>{cs.steering.sessions_with_mid_run_redirect} mid-run redirect{cs.steering.sessions_with_mid_run_redirect === 1 ? "" : "s"}</Chip>
          )}
        </SignalsRow>
      )}

      {(signals.brainstorm_warmup_session_count > 0 || signals.todo_ops_total > 0 || signals.plan_mode_used) && (
        <SignalsRow label="Discipline">
          {signals.brainstorm_warmup_session_count > 0 && (
            <Chip>brainstorm warmup ×{signals.brainstorm_warmup_session_count}</Chip>
          )}
          {signals.todo_ops_total > 0 && <Chip>{signals.todo_ops_total} TodoWrite ops</Chip>}
          {signals.plan_mode_used && <Chip tone="user">Plan Mode used</Chip>}
        </SignalsRow>
      )}
    </section>
  );
}

function SignalsRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      padding: "4px 0", fontSize: 12,
    }}>
      <span style={{
        minWidth: 100, color: "var(--af-text-tertiary)", fontWeight: 500,
        fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em",
      }}>
        {label}
      </span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>{children}</div>
    </div>
  );
}

function Chip({ children, tone, title }: { children: ReactNode; tone?: "user" | "stock"; title?: string }) {
  const bg = tone === "user" ? "var(--af-accent-subtle)" : "var(--af-border-subtle)";
  const fg = tone === "user" ? "var(--af-accent)" : "var(--af-text-secondary)";
  return (
    <span title={title} style={{
      display: "inline-flex", alignItems: "center", padding: "2px 8px",
      borderRadius: 999, fontSize: 11, fontFamily: "var(--font-mono)",
      background: bg, color: fg, whiteSpace: "nowrap",
      maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis",
    }}>
      {children}
    </span>
  );
}

function SessionRow({ entry }: { entry: Entry }) {
  const startTime = new Date(entry.start_iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  const durMin = Math.round(entry.numbers.active_min);
  const projectLabel = entry.project.split("/").filter(Boolean).slice(-1)[0] ?? entry.project;
  const outcome = entry.enrichment.outcome;
  const summary = entry.enrichment.brief_summary;

  return (
    <a href={`/sessions/${entry.session_id}`} style={{
      display: "block", padding: "8px 0", borderBottom: "1px solid var(--af-border-subtle)",
      fontSize: 13, color: "var(--af-text)", textDecoration: "none",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--af-text-tertiary)", width: 48 }}>
          {startTime}
        </span>
        <span style={{ fontSize: 11, color: "var(--af-text-tertiary)", minWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {projectLabel}
        </span>
        <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--af-text-tertiary)", width: 40, textAlign: "right" }}>
          {durMin}m
        </span>
        {outcome && <OutcomePill outcome={outcome} size="sm" label="text" agent={entry.agent} />}
      </div>
      {summary && (
        <div style={{
          marginTop: 3, marginLeft: 58, fontSize: 13, color: "var(--af-text-secondary)",
          lineHeight: 1.45, maxWidth: 820,
        }}>
          {summary}
        </div>
      )}
    </a>
  );
}


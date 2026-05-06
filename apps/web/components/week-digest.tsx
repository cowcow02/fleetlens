"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import type { WeekDigest as WeekDigestType, DayHelpfulness, WeekTopSession, SessionPin } from "@claude-lens/entries";
import { renderWithFlagChips } from "./flag-chip";
import { GoalBar } from "./goal-bar";
import { AgentBadge } from "./agent-badge";

const HELP_COLORS: Record<NonNullable<DayHelpfulness>, string> = {
  essential: "#48bb78",
  helpful: "#4299e1",
  neutral: "#a0aec0",
  unhelpful: "#f56565",
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const SHIPPED_COLLAPSE_THRESHOLD = 10;
const PROJECT_MIN_SHARE = 5;

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

const SHAPE_COLORS: Record<string, string> = {
  "spec-review-loop": "#9f7aea",
  "chunk-implementation": "#4299e1",
  "research-then-build": "#38b2ac",
  "reviewer-triad": "#ed64a6",
  "background-coordinated": "#ecc94b",
  "solo-continuation": "#a0aec0",
  "solo-design": "#48bb78",
  "solo-build": "#ed8936",
  "mixed": "#a0aec0",
};

const SHAPE_DESCRIPTIONS: Record<string, string> = {
  "spec-review-loop": "Write a spec → dispatch reviewer subagents → revise → re-review → implement.",
  "chunk-implementation": "Numbered Chunk/Task subagent dispatches with paired reviewers per chunk.",
  "research-then-build": "Explore/researcher subagents map terrain upfront, then build with a clear picture.",
  "reviewer-triad": "Three reviewer dispatches with distinct lenses (reuse / quality / efficiency) on the same diff.",
  "background-coordinated": "A background subagent runs in parallel with the foreground session.",
  "solo-continuation": "No subagents; first input was \"continue\" picking up from a prior session.",
  "solo-design": "No subagents; loaded the brainstorming/writing-plans skill — design or planning session.",
  "solo-build": "No subagents; direct hands-on work.",
};

const SURPRISE_LABELS: Record<string, string> = {
  "outlier": "Outlier",
  "novel-use": "Novel use",
  "user-built-tool": "User-built tool",
  "cross-week-contrast": "Cross-week contrast",
};

const LEAN_KIND_LABELS: Record<string, string> = {
  "claude-md": "CLAUDE.md addition",
  "skill": "Skill to build",
  "hook": "Hook to wire",
  "harness": "Harness extension",
  "decision": "Decision to make",
};

const FRAME_LABELS: Record<string, string> = {
  "teammate": "<teammate-message>",
  "task-notification": "<task-notification>",
  "local-command-caveat": "<local-command-caveat>",
  "slash-command": "Slash command (<command-name>)",
  "image-attached": "[Image #N]",
  "handoff-prose": "Handoff prose",
};

const FRAME_HELP: Record<string, string> = {
  "teammate": "From Claude's agent-teams feature — coordinator dispatching to a teammate role.",
  "task-notification": "From Claude's Monitor tool — the user's auto-monitor triggers a session.",
  "local-command-caveat": "Claude convention wrapping local-command output to prevent prompt-injection.",
  "slash-command": "A custom or stock slash-command invoked by the user.",
  "image-attached": "User opened with one or more screenshots.",
  "handoff-prose": "Personal habit: cross-session compaction prompt copied from a prior session.",
};

export function WeekDigest({
  digest, aiEnabled, actions, priorDigest,
}: {
  digest: WeekDigestType;
  aiEnabled: boolean;
  actions?: ReactNode;
  priorDigest?: WeekDigestType | null;
}) {
  const totalShipped = digest.shipped.length;
  const dayCount = Object.values(digest.outcome_mix).reduce((a, b) => a + (b ?? 0), 0);
  const hrs = digest.agent_min_total / 60;
  const timeStr = hrs >= 1 ? `${hrs.toFixed(1)}h` : `${Math.round(digest.agent_min_total)}m`;
  const delta = priorDigest ? buildDelta(digest, priorDigest) : null;

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "24px 40px" }}>
      <header style={{ marginBottom: 24 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, marginBottom: 8,
          fontSize: 12, color: "var(--af-text-tertiary)", fontWeight: 500,
          flexWrap: "wrap",
        }}>
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--af-text-secondary)" }}>
            {timeStr} agent time · {dayCount} active day{dayCount === 1 ? "" : "s"} · {totalShipped} PR{totalShipped === 1 ? "" : "s"}
          </span>
          {delta && (
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 11,
              color: "var(--af-text-tertiary)",
              padding: "1px 7px", borderRadius: 999,
              border: "1px solid var(--af-border-subtle)",
            }} title="vs the prior calendar week">
              vs last week: {delta}
            </span>
          )}
          {actions && (
            <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
              {actions}
            </div>
          )}
        </div>
        {digest.headline ? (
          <h1 style={{
            fontSize: 26, fontWeight: 700, lineHeight: 1.3, letterSpacing: "-0.02em",
            margin: "0 0 6px", maxWidth: 820, color: "var(--af-text)",
          }}>
            {renderWithFlagChips(digest.headline)}
          </h1>
        ) : (
          <h1 style={{ fontSize: 20, color: "var(--af-text-secondary)", margin: "0 0 14px" }}>
            {aiEnabled
              ? "No narrative yet."
              : `Worked ${timeStr} across ${digest.projects.length} project${digest.projects.length === 1 ? "" : "s"}.`}
          </h1>
        )}
        {digest.key_pattern && (
          <p style={{
            fontSize: 13, fontStyle: "italic", margin: 0, lineHeight: 1.5,
            color: "var(--af-text-secondary)", maxWidth: 820,
          }}>
            {renderWithFlagChips(digest.key_pattern)}
          </p>
        )}
      </header>

      {!aiEnabled && (
        <div style={{
          padding: 14, marginBottom: 24, background: "var(--af-accent-subtle)",
          borderRadius: 8, fontSize: 13, color: "var(--af-text)",
        }}>
          Enable AI features in <Link href="/settings" style={{ color: "var(--af-accent)" }}>Settings</Link> to see weekly narratives.
        </div>
      )}

      {/* ── §1: This week at a glance — totals, time distribution, goal mix ── */}
      <WeekStatsStrip digest={digest} />

      <DaysActiveBars digest={digest} />

      {digest.top_goal_categories.length > 0 && (
        <Section title="Goal mix" anchor="goals">
          <GoalBar goals={digest.top_goal_categories} total={digest.agent_min_total} />
        </Section>
      )}

      {/* ── §2: Through the week — trajectory + standout days + project areas ── */}
      <ThroughTheWeek digest={digest} />

      {/* ── §3: Top 3 sessions — per-session deep-dive ── */}
      {digest.top_sessions && digest.top_sessions.length > 0 && (
        <TopSessionsSection sessions={digest.top_sessions} />
      )}

      {/* ── §4: Findings narrative — what worked / stalled / surprised / lean ── */}
      <FindingsSection
        title="What worked"
        anchor="what-worked"
        items={digest.what_worked ?? []}
        tone="#48bb78"
        sectionFallbackProse={null}
      />

      <FindingsSection
        title="What stalled"
        anchor="what-stalled"
        items={digest.what_stalled ?? []}
        tone="#ed8936"
        sectionFallbackProse="No stalls stuck this week."
      />

      <SurprisesSection items={digest.what_surprised ?? []} />

      <WhereToLeanSection items={digest.where_to_lean ?? []} />

      {/* ── Bottom: shipped list (kept) + legacy fallback ──
          Removed PatternRollupsFold (working_shapes + interaction_grammar
          UI) and ByTheNumbersFold (interaction_modes). They were collapsed
          by default and rarely expanded; the LLM's findings already cite
          shape/grammar names by anchor, so the rollup tables were
          redundant context. Their feeder data is still on the digest for
          back-compat — only the rendering is gone. */}
      <ShippedList shipped={digest.shipped} />

      {!digest.working_shapes && (
        <LegacyNarrativeFallback digest={digest} />
      )}
    </div>
  );
}

function LegacyNarrativeFallback({ digest }: { digest: WeekDigestType }) {
  const themes = digest.recurring_themes ?? [];
  const correlations = digest.outcome_correlations ?? [];
  const friction = digest.friction_categories ?? [];
  const suggestions = digest.suggestions;
  const horizon = digest.on_the_horizon;
  const fun = digest.fun_ending;
  const hasAny = themes.length > 0 || correlations.length > 0 || friction.length > 0
    || (suggestions?.claude_md_additions?.length ?? 0) > 0
    || horizon || fun;
  if (!hasAny) return null;
  return (
    <div style={{
      padding: "14px 16px", marginTop: 18, borderRadius: 8,
      background: "color-mix(in srgb, var(--af-text-tertiary) 5%, var(--af-surface))",
      border: "1px dashed var(--af-border-subtle)",
      fontSize: 12, color: "var(--af-text-secondary)", lineHeight: 1.55,
    }}>
      <strong style={{ color: "var(--af-text)" }}>Legacy digest:</strong> this week was generated under a previous prompt.
      Re-roll the digest to refresh it under the new working-shapes narrative.
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

type StatCard = {
  label: string;
  primary: string;
  detail: string;
  href?: string;
  title?: string;
  visual?: ReactNode;
};

function WeekStatsStrip({ digest }: { digest: WeekDigestType }) {
  const totalHrs = digest.agent_min_total / 60;
  const totalStr = totalHrs >= 1 ? `${totalHrs.toFixed(1)}h` : `${Math.round(digest.agent_min_total)}m`;
  const peakHourBucket = peakHour(digest.hours_distribution);

  // Per-day agent_min for the mini-bar in Agent time / Busiest day cards
  const dayMap = new Map(digest.days_active.map(d => [d.date, d]));
  const weekDates = weekDateLabels(digest.window.start);
  const perDayAgent = weekDates.map(d => dayMap.get(d)?.agent_min ?? 0);
  const maxAgent = Math.max(...perDayAgent, 1);

  // Busiest day index for highlight
  const busiestIdx = digest.busiest_day
    ? weekDates.indexOf(digest.busiest_day.date)
    : -1;

  // Longest run vs busiest day's total (for the bar visual)
  const longestRunRatio = digest.longest_run && digest.busiest_day
    ? Math.min(1, digest.longest_run.active_min / Math.max(1, digest.busiest_day.agent_min))
    : 0;

  const cards: StatCard[] = [];

  cards.push({
    label: "Agent time",
    primary: totalStr,
    detail: `across ${digest.days_active.length} day${digest.days_active.length === 1 ? "" : "s"}`,
    visual: <MiniDayBars values={perDayAgent} max={maxAgent} highlight={-1} />,
  });

  if (digest.busiest_day) {
    cards.push({
      label: "Busiest day",
      href: `/digest/${digest.busiest_day.date}`,
      primary: `${dayName(digest.busiest_day.date)} ${digest.busiest_day.date.slice(5)}`,
      detail: `${Math.round(digest.busiest_day.agent_min)}m · ${digest.busiest_day.shipped_count} PR${digest.busiest_day.shipped_count === 1 ? "" : "s"}`,
      visual: <MiniDayBars values={perDayAgent} max={maxAgent} highlight={busiestIdx} />,
    });
  }

  if (digest.longest_run) {
    cards.push({
      label: "Longest single run",
      href: `/sessions/${digest.longest_run.session_id}`,
      title: `Session ${digest.longest_run.session_id.slice(0, 8)}`,
      primary: `${Math.round(digest.longest_run.active_min)}m`,
      detail: `${digest.longest_run.project_display} · ${dayName(digest.longest_run.date)} ${digest.longest_run.date.slice(5)}`,
      visual: <MiniRatioBar ratio={longestRunRatio} caption="vs busiest day" />,
    });
  }

  if (peakHourBucket) {
    cards.push({
      label: "Peak hours",
      title: `${formatHourRange(peakHourBucket.start, peakHourBucket.end)} carried ${peakHourBucket.share_pct.toFixed(0)}% of the week's agent time`,
      primary: formatHourRange(peakHourBucket.start, peakHourBucket.end),
      detail: `${peakHourBucket.share_pct.toFixed(0)}% of agent time`,
      visual: <MiniHoursSparkline hours={digest.hours_distribution} peakStart={peakHourBucket.start} peakEnd={peakHourBucket.end} />,
    });
  }

  if (cards.length === 0) return null;

  return (
    <section style={{
      display: "grid",
      gridTemplateColumns: `repeat(${Math.min(cards.length, 4)}, minmax(0, 1fr))`,
      gap: 10,
      marginBottom: 20,
    }}>
      {cards.map((s, i) => {
        const inner = (
          <div style={{
            padding: "12px 14px", borderRadius: 10,
            background: "var(--af-surface)",
            border: "1px solid var(--af-border-subtle)",
            height: "100%",
            display: "flex", flexDirection: "column", justifyContent: "space-between",
            minHeight: 90,
          }} title={s.title}>
            <div>
              <div style={{
                fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                textTransform: "uppercase", color: "var(--af-text-tertiary)",
                marginBottom: 6,
              }}>{s.label}</div>
              <div style={{
                fontSize: 17, fontWeight: 600, color: "var(--af-text)",
                letterSpacing: "-0.01em", lineHeight: 1.2,
              }}>{s.primary}</div>
              <div style={{
                fontSize: 10.5, color: "var(--af-text-tertiary)",
                fontFamily: "var(--font-mono)", marginTop: 3,
              }}>{s.detail}</div>
            </div>
            {s.visual && <div style={{ marginTop: 10 }}>{s.visual}</div>}
          </div>
        );
        return s.href ? (
          <Link key={i} href={s.href} style={{ textDecoration: "none" }}>{inner}</Link>
        ) : (
          <div key={i}>{inner}</div>
        );
      })}
    </section>
  );
}

/** 7-day mini-bar — shows daily agent_min distribution. When highlight≥0
 *  that day glows in accent; others stay subtle. */
function MiniDayBars({ values, max, highlight }: { values: number[]; max: number; highlight: number }) {
  return (
    <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 18 }}>
      {values.map((v, i) => {
        const h = max > 0 ? Math.max(1, (v / max) * 18) : 1;
        const isHi = i === highlight;
        return (
          <div key={i} style={{
            flex: 1,
            height: h,
            borderRadius: 1,
            background: isHi
              ? "var(--af-accent)"
              : v > 0
                ? "color-mix(in srgb, var(--af-accent) 30%, transparent)"
                : "var(--af-border-subtle)",
          }} />
        );
      })}
    </div>
  );
}

/** Single horizontal bar showing a 0..1 ratio with a caption underneath. */
function MiniRatioBar({ ratio, caption }: { ratio: number; caption: string }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div>
      <div style={{
        height: 6, borderRadius: 99, overflow: "hidden",
        background: "var(--af-border-subtle)",
      }}>
        <div style={{
          width: `${pct}%`, height: "100%",
          background: "var(--af-accent)",
        }} />
      </div>
      <div style={{
        fontSize: 9, color: "var(--af-text-tertiary)",
        fontFamily: "var(--font-mono)", marginTop: 3,
      }}>{Math.round(pct)}% {caption}</div>
    </div>
  );
}

/** 24-bar sparkline of hours_distribution with the peak window glowing. */
function MiniHoursSparkline({ hours, peakStart, peakEnd }: { hours: number[]; peakStart: number; peakEnd: number }) {
  const max = Math.max(...hours, 1);
  return (
    <div style={{ display: "flex", gap: 1, alignItems: "flex-end", height: 18 }}>
      {hours.map((v, h) => {
        const inPeak = h >= peakStart && h <= peakEnd;
        const height = max > 0 ? Math.max(1, (v / max) * 18) : 1;
        return (
          <div key={h} style={{
            flex: 1,
            height,
            borderRadius: 1,
            background: inPeak
              ? "var(--af-accent)"
              : v > 0
                ? "color-mix(in srgb, var(--af-accent) 22%, transparent)"
                : "var(--af-border-subtle)",
          }} />
        );
      })}
    </div>
  );
}

function DaysActiveBars({ digest }: { digest: WeekDigestType }) {
  if (digest.days_active.length === 0) return null;
  const maxMin = Math.max(...digest.days_active.map(d => d.agent_min));
  const dayMap = new Map(digest.days_active.map(d => [d.date, d]));
  const dates = weekDateLabels(digest.window.start);
  return (
    <section style={{
      display: "flex", gap: 6, alignItems: "stretch",
      padding: "12px 0", marginBottom: 24,
    }}>
      {dates.map((date, i) => {
        const d = dayMap.get(date);
        const mins = d?.agent_min ?? 0;
        const heightPct = maxMin > 0 && mins > 0 ? Math.max(8, (mins / maxMin) * 100) : 0;
        const tone = d ? OUTCOME_TONE[d.outcome_day] : "var(--af-text-tertiary)";
        const helpTone = d?.helpfulness_day ? HELP_COLORS[d.helpfulness_day] : null;
        return (
          <Link
            key={i}
            href={d ? `/digest/${date}` : "#"}
            style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 2,
              textDecoration: "none",
              pointerEvents: d ? "auto" : "none",
            }}
            title={d
              ? `${date} · ${Math.round(mins)}m · ${d.outcome_day}${d.shipped_count > 0 ? ` · ${d.shipped_count} PR` : ""}${d.helpfulness_day ? ` · helpfulness ${d.helpfulness_day}` : ""}`
              : "no activity"
            }
          >
            <div style={{
              height: 56, borderRadius: 4, position: "relative",
              background: "var(--af-surface)",
              border: `1px solid ${d ? `color-mix(in srgb, ${tone} 28%, var(--af-border-subtle))` : "var(--af-border-subtle)"}`,
              overflow: "hidden",
            }}>
              {d && (
                <div style={{
                  position: "absolute", bottom: 0, left: 0, right: 0,
                  height: `${heightPct}%`,
                  background: `color-mix(in srgb, ${tone} 28%, transparent)`,
                }} />
              )}
              {d?.dominant_shape && SHAPE_COLORS[d.dominant_shape] && (
                <div
                  title={`${SHAPE_LABELS[d.dominant_shape] ?? d.dominant_shape}`}
                  style={{
                    position: "absolute", top: 0, left: 0, right: 0,
                    height: 3,
                    background: SHAPE_COLORS[d.dominant_shape],
                  }}
                />
              )}
              {helpTone && (
                <div style={{
                  position: "absolute", top: 4, right: 4,
                  width: 6, height: 6, borderRadius: 999,
                  background: helpTone,
                }} title={d?.helpfulness_day ?? ""} />
              )}
            </div>
            <div style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
              color: "var(--af-text-tertiary)", textAlign: "center",
            }}>
              {DAY_LABELS[i]}
            </div>
            <div style={{
              fontSize: 9, fontFamily: "var(--font-mono)",
              color: d ? "var(--af-text-secondary)" : "var(--af-text-tertiary)",
              textAlign: "center",
            }}>
              {d ? `${Math.round(mins)}m` : "—"}
            </div>
          </Link>
        );
      })}
    </section>
  );
}

function ByTheNumbersFold({ modes }: { modes: NonNullable<WeekDigestType["interaction_modes"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <section style={{ marginBottom: 28 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "transparent", border: "none", cursor: "pointer",
          padding: "6px 0", color: "var(--af-text-tertiary)",
          fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {open ? "▾" : "▸"} By the numbers
      </button>
      {open && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 8, marginTop: 8,
        }}>
          <NumberCard label="Orchestration" lines={[
            `${modes.orchestration.subagent_calls} dispatches · ${modes.orchestration.days_with_subagents}/7 days`,
            modes.orchestration.top_types.slice(0, 3).map(t => `${t.type} ×${t.count}`).join(" · "),
            modes.orchestration.task_ops > 0 ? `${modes.orchestration.task_ops} TodoWrite ops` : "",
          ].filter(Boolean)} />
          <NumberCard label="Skill-driven" lines={[
            `${modes.skill_use.skill_calls} loads · ${modes.skill_use.days_with_skills}/7 days`,
            modes.skill_use.top_skills.slice(0, 3).map(s => `${s.skill} ×${s.count}`).join(" · "),
          ].filter(Boolean)} />
          <NumberCard label="Plan-gated" lines={[
            `${modes.plan_gating.exit_plan_calls} ExitPlan · ${modes.plan_gating.days_with_plan}/7 days`,
          ]} />
          <NumberCard label="Turn shape" lines={[
            `${modes.turn_shape.tools_per_turn.toFixed(1)} tools/turn · ${modes.turn_shape.label}`,
            `${modes.turn_shape.long_autonomous_days} long-autonomous days · ${modes.turn_shape.interrupts} interrupts`,
          ]} />
        </div>
      )}
    </section>
  );
}

function NumberCard({ label, lines }: { label: string; lines: string[] }) {
  return (
    <div style={{
      padding: "10px 12px", borderRadius: 8,
      background: "var(--af-surface)",
      border: "1px solid var(--af-border-subtle)",
    }}>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
        textTransform: "uppercase", color: "var(--af-text-tertiary)",
        marginBottom: 4,
      }}>{label}</div>
      {lines.map((ln, i) => (
        <div key={i} style={{
          fontSize: 11, color: i === 0 ? "var(--af-text)" : "var(--af-text-secondary)",
          fontFamily: "var(--font-mono)", lineHeight: 1.45,
        }}>{ln}</div>
      ))}
    </div>
  );
}

const OUTCOME_TONE: Record<string, string> = {
  shipped: "#48bb78",
  partial: "#4299e1",
  blocked: "#f56565",
  exploratory: "#a0aec0",
  trivial: "#cbd5e0",
  idle: "#cbd5e0",
};

/** Smallest window length we accept as a "peak"; below this and the window
 *  isn't carrying enough of the week's activity to be characteristic. */
const PEAK_HOUR_COVERAGE_THRESHOLD = 0.6;

function peakHour(hours: number[]): { start: number; end: number; share_pct: number } | null {
  const total = hours.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  for (let len = 1; len <= 24; len++) {
    let bestSum = 0, bestStart = 0;
    for (let s = 0; s <= 24 - len; s++) {
      let sum = 0;
      for (let i = 0; i < len; i++) sum += hours[s + i] ?? 0;
      if (sum > bestSum) { bestSum = sum; bestStart = s; }
    }
    if (bestSum / total >= PEAK_HOUR_COVERAGE_THRESHOLD) {
      return { start: bestStart, end: bestStart + len, share_pct: (bestSum / total) * 100 };
    }
  }
  return null;
}

function formatHourRange(start: number, end: number): string {
  const fmt = (h: number) => {
    const period = h < 12 || h === 24 ? "am" : "pm";
    const mod = ((h % 12) || 12);
    return `${mod}${period}`;
  };
  return `${fmt(start)}–${fmt(end)}`;
}

function weekDateLabels(startIso: string): string[] {
  const out: string[] = [];
  const start = new Date(startIso);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

function DayChips({ dates, tone }: { dates: string[]; tone: string }) {
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {dates.map(d => (
        <Link key={d} href={`/digest/${d}`} style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "2px 8px", borderRadius: 999,
          background: `color-mix(in srgb, ${tone} 12%, transparent)`,
          border: `1px solid color-mix(in srgb, ${tone} 28%, transparent)`,
          fontSize: 10, fontFamily: "var(--font-mono)",
          color: tone, textDecoration: "none", fontWeight: 600,
        }}>
          {dayName(d)} {d.slice(5)}
        </Link>
      ))}
    </div>
  );
}

/** "Through the week" combined section — trajectory + standout days +
 *  project areas under one heading. Trajectory + standout share the top row
 *  in two columns (60/40); project areas spread below in a 2-col grid. */
function ThroughTheWeek({ digest }: { digest: WeekDigestType }) {
  const hasTrajectory = digest.trajectory && digest.trajectory.length > 0;
  const hasStandout = digest.standout_days && digest.standout_days.length > 0;
  const visibleProjects = digest.projects.filter(p => p.share_pct >= PROJECT_MIN_SHARE || p.shipped_count > 0);
  const hasProjects = visibleProjects.length > 0;
  if (!hasTrajectory && !hasStandout && !hasProjects) return null;

  return (
    <Section title="Through the week" anchor="through-the-week">
      {(hasTrajectory || hasStandout) && (
        <div style={{
          display: "grid",
          gridTemplateColumns: hasTrajectory && hasStandout ? "minmax(0, 1.4fr) minmax(0, 1fr)" : "1fr",
          gap: 28, marginBottom: hasProjects ? 22 : 0,
        }}>
          {hasTrajectory && (
            <div>
              <SubSectionLabel>Trajectory</SubSectionLabel>
              <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {digest.trajectory!.map(t => (
                  <li key={t.date} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <Link href={`/digest/${t.date}`} style={{
                      fontSize: 10, fontWeight: 600, color: "var(--af-text-tertiary)",
                      fontFamily: "var(--font-mono)", flexShrink: 0, width: 64, paddingTop: 3,
                      textDecoration: "none",
                    }}>
                      {dayName(t.date)} {t.date.slice(5)}
                    </Link>
                    <span style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--af-text-secondary)" }}>
                      {renderWithFlagChips(t.line)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {hasStandout && (
            <div>
              <SubSectionLabel>Standout days</SubSectionLabel>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {digest.standout_days!.map(s => (
                  <li key={s.date} style={{
                    padding: "10px 12px", borderRadius: 8, background: "var(--af-surface)",
                    border: "1px solid var(--af-border-subtle)",
                  }}>
                    <Link href={`/digest/${s.date}`} style={{
                      fontSize: 11, fontWeight: 600,
                      color: "var(--af-accent)", textDecoration: "none",
                      fontFamily: "var(--font-mono)", marginRight: 8,
                    }}>
                      {dayName(s.date)} {s.date.slice(5)}
                    </Link>
                    <span style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--af-text)" }}>
                      {renderWithFlagChips(s.why)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {hasProjects && (
        <div>
          <SubSectionLabel>Project areas</SubSectionLabel>
          <ul style={{
            listStyle: "none", padding: 0, margin: 0,
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 10,
          }}>
            {visibleProjects.map(p => (
              <li key={p.name} style={{
                padding: "11px 13px", borderRadius: 8,
                background: "var(--af-surface)",
                border: "1px solid var(--af-border-subtle)",
                display: "flex", flexDirection: "column",
              }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: p.description ? 6 : 0 }}>
                  <Link
                    href={`/projects/${encodeURIComponent(p.name)}`}
                    style={{ fontSize: 13, fontWeight: 600, color: "var(--af-text)", textDecoration: "none", flex: 1, minWidth: 0, letterSpacing: "-0.01em" }}
                  >
                    {p.display_name}
                  </Link>
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: 10,
                    color: "var(--af-text-tertiary)",
                  }}>
                    {Math.round(p.agent_min)}m · {p.share_pct.toFixed(0)}% · {p.shipped_count} PR
                  </span>
                </div>
                {p.description && (
                  <p style={{ fontSize: 12, lineHeight: 1.5, margin: 0, color: "var(--af-text-secondary)" }}>
                    {p.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function SubSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: 10, color: "var(--af-text-tertiary)", textTransform: "uppercase",
      letterSpacing: "0.08em", fontWeight: 700, marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

function CopyBlock({ label, payload }: { label: string; payload: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <pre style={{
        margin: 0,
        padding: "10px 12px",
        paddingRight: 96,
        borderRadius: 6,
        background: "var(--af-surface-raised)",
        border: "1px solid var(--af-border-subtle)",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        color: "var(--af-text)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        lineHeight: 1.55,
        overflowX: "auto",
        maxHeight: 280,
        overflowY: "auto",
      }}>{payload}</pre>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(payload);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // best-effort
          }
        }}
        style={{
          position: "absolute", top: 8, right: 8,
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "4px 8px", borderRadius: 5,
          background: copied ? "color-mix(in srgb, #48bb78 18%, var(--af-surface))" : "var(--af-surface)",
          border: `1px solid ${copied ? "#48bb78" : "var(--af-border-subtle)"}`,
          color: copied ? "#48bb78" : "var(--af-text-secondary)",
          fontSize: 10, fontWeight: 600, cursor: "pointer",
        }}
      >
        {copied ? <><Check size={10} /> Copied</> : <><Copy size={10} /> {label}</>}
      </button>
    </div>
  );
}

function ShippedList({ shipped }: { shipped: WeekDigestType["shipped"] }) {
  const [expanded, setExpanded] = useState(false);
  if (shipped.length === 0) return null;
  const collapsible = shipped.length >= SHIPPED_COLLAPSE_THRESHOLD;
  const visible = collapsible && !expanded ? shipped.slice(0, 5) : shipped;
  const hidden = shipped.length - visible.length;
  return (
    <Section title={`Shipped (${shipped.length})`} anchor="shipped">
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {visible.map((s, i) => (
          <li key={i} style={{
            display: "flex", gap: 10, alignItems: "baseline",
            padding: "6px 10px", borderRadius: 6,
            fontSize: 12, color: "var(--af-text)",
          }}>
            <Link href={`/digest/${s.date}`} style={{
              fontFamily: "var(--font-mono)", fontSize: 10,
              color: "var(--af-text-tertiary)", flexShrink: 0, width: 56,
              textDecoration: "none",
            }}>
              {dayName(s.date)} {s.date.slice(5)}
            </Link>
            <span style={{ flex: 1, minWidth: 0 }}>{s.title}</span>
            <span style={{
              fontSize: 10, color: "var(--af-text-tertiary)",
              fontFamily: "var(--font-mono)",
            }}>
              {s.project}
            </span>
          </li>
        ))}
      </ul>
      {collapsible && hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            marginTop: 6, padding: "4px 10px", borderRadius: 5,
            background: "transparent", border: "1px solid var(--af-border-subtle)",
            fontSize: 10, color: "var(--af-text-secondary)", cursor: "pointer",
            fontFamily: "var(--font-mono)",
          }}
        >
          +{hidden} more
        </button>
      )}
      {collapsible && expanded && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          style={{
            marginTop: 6, padding: "4px 10px", borderRadius: 5,
            background: "transparent", border: "1px solid var(--af-border-subtle)",
            fontSize: 10, color: "var(--af-text-secondary)", cursor: "pointer",
            fontFamily: "var(--font-mono)",
          }}
        >
          show less
        </button>
      )}
    </Section>
  );
}

function buildDelta(curr: WeekDigestType, prior: WeekDigestType): string {
  const prDelta = curr.shipped.length - prior.shipped.length;
  const minDelta = curr.agent_min_total - prior.agent_min_total;
  const hrDelta = minDelta / 60;
  const prStr = `${prDelta > 0 ? "+" : ""}${prDelta} PR${Math.abs(prDelta) === 1 ? "" : "s"}`;
  const timeStr = Math.abs(hrDelta) >= 1
    ? `${hrDelta > 0 ? "+" : ""}${hrDelta.toFixed(1)}h`
    : `${minDelta > 0 ? "+" : ""}${Math.round(minDelta)}m`;
  return `${prStr} · ${timeStr}`;
}

// ─── New shape-anchored sections ─────────────────────────────────────────

function WorkingShapesSection({
  shapes,
}: {
  shapes: NonNullable<WeekDigestType["working_shapes"]>;
}) {
  return (
    <Section title="How you worked" anchor="how-you-worked">
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {shapes.map((row, i) => {
          const label = SHAPE_LABELS[row.shape] ?? row.shape;
          const description = SHAPE_DESCRIPTIONS[row.shape] ?? "";
          const dayCount = new Set(row.occurrences.map(o => o.date)).size;
          const outcomeStr = formatOutcomeMix(row.outcome_distribution);
          // Prefer the occurrence whose day carries a day_signature for evidence —
          // that's the new day-first signal, more readable than a subagent prompt.
          const sample = row.occurrences.find(o => o.day_signature)
            ?? row.occurrences.find(o => o.evidence_subagent !== null)
            ?? row.occurrences[0]!;
          return (
            <li key={i} style={{
              padding: "14px 16px", borderRadius: 10,
              background: "var(--af-surface)",
              border: "1px solid var(--af-border-subtle)",
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                <span style={{
                  fontSize: 13, fontWeight: 600, color: "var(--af-text)",
                  letterSpacing: "-0.01em",
                }}>{label}</span>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 11,
                  color: "var(--af-text-tertiary)",
                }}>
                  {row.occurrences.length} session{row.occurrences.length === 1 ? "" : "s"} · {dayCount} day{dayCount === 1 ? "" : "s"}{outcomeStr ? ` · ${outcomeStr}` : ""}
                </span>
              </div>
              {description && (
                <p style={{
                  fontSize: 12, lineHeight: 1.55, margin: "0 0 8px",
                  color: "var(--af-text-secondary)",
                }}>{description}</p>
              )}
              {sample.day_signature ? (
                <div style={{
                  marginBottom: 8, padding: "8px 10px", borderRadius: 6,
                  background: "var(--af-surface-raised)",
                  borderLeft: "2px solid var(--af-accent)",
                }}>
                  <div style={{
                    fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
                    color: "var(--af-accent)", fontFamily: "var(--font-mono)",
                    marginBottom: 3,
                  }}>
                    {dayName(sample.date)} {sample.date.slice(5)}{sample.project_display ? ` · ${sample.project_display}` : ""}
                  </div>
                  <div style={{
                    fontSize: 11, lineHeight: 1.5,
                    color: "var(--af-text)", fontStyle: "italic",
                  }}>
                    <span style={{ color: "var(--af-text-tertiary)" }}>“</span>
                    {sample.day_signature}
                    <span style={{ color: "var(--af-text-tertiary)" }}>”</span>
                  </div>
                </div>
              ) : sample.evidence_subagent ? (
                <div style={{
                  marginBottom: 8, padding: "8px 10px", borderRadius: 6,
                  background: "var(--af-surface-raised)",
                  borderLeft: "2px solid var(--af-accent)",
                }}>
                  <div style={{
                    fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
                    color: "var(--af-accent)", fontFamily: "var(--font-mono)",
                    marginBottom: 3,
                  }}>
                    {sample.evidence_subagent.type} · {dayName(sample.date)} {sample.date.slice(5)} · {sample.project_display}
                  </div>
                  <div style={{
                    fontSize: 11, lineHeight: 1.5,
                    color: "var(--af-text)", fontStyle: "italic",
                  }}>
                    <span style={{ color: "var(--af-text-tertiary)" }}>“</span>
                    {sample.evidence_subagent.prompt_preview}
                    <span style={{ color: "var(--af-text-tertiary)" }}>”</span>
                  </div>
                </div>
              ) : sample.evidence_first_user ? (
                <div style={{
                  marginBottom: 8, padding: "8px 10px", borderRadius: 6,
                  background: "var(--af-surface-raised)",
                  borderLeft: "2px solid var(--af-border)",
                }}>
                  <div style={{
                    fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
                    color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)",
                    marginBottom: 3,
                  }}>
                    {dayName(sample.date)} {sample.date.slice(5)} · {sample.project_display}
                  </div>
                  <div style={{
                    fontSize: 11, lineHeight: 1.5,
                    color: "var(--af-text)", fontStyle: "italic",
                  }}>
                    <span style={{ color: "var(--af-text-tertiary)" }}>“</span>
                    {sample.evidence_first_user}
                    <span style={{ color: "var(--af-text-tertiary)" }}>”</span>
                  </div>
                </div>
              ) : null}
              {row.occurrences.length > 1 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {row.occurrences.map((o, j) => (
                    <Link key={j} href={`/digest/${o.date}`} style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "2px 8px", borderRadius: 999,
                      background: "color-mix(in srgb, var(--af-accent) 8%, transparent)",
                      border: "1px solid color-mix(in srgb, var(--af-accent) 22%, transparent)",
                      fontSize: 10, fontFamily: "var(--font-mono)",
                      color: "var(--af-accent)", textDecoration: "none", fontWeight: 600,
                    }}>
                      {dayName(o.date)} {o.date.slice(5)} · {o.project_display}
                      {o.outcome ? ` · ${o.outcome}` : ""}
                    </Link>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function formatOutcomeMix(dist: Partial<Record<string, number>>): string {
  const order = ["shipped", "partial", "blocked", "exploratory", "trivial", "idle"];
  const parts: string[] = [];
  for (const k of order) {
    const c = dist[k] ?? 0;
    if (c > 0) parts.push(`${c} ${k}`);
  }
  return parts.join(" · ");
}

function InteractionGrammarSection({
  grammar,
}: {
  grammar: NonNullable<WeekDigestType["interaction_grammar"]>;
}) {
  const harnessLines = renderHarnessLines(grammar);
  const commLines = renderCommunicationLines(grammar);
  const claudeFeatureLines = renderClaudeFeatureLines(grammar);
  const miscLines = renderMiscGrammarLines(grammar);
  const allLines = [...harnessLines, ...commLines, ...claudeFeatureLines, ...miscLines];

  if (allLines.length === 0) return null;
  return (
    <Section title="Your interaction grammar" anchor="grammar">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {harnessLines.length > 0 && (
          <GrammarSubsection title="Your own harness" subtitle="Skills, subagents, and slash commands you authored.">
            {harnessLines}
          </GrammarSubsection>
        )}
        {commLines.length > 0 && (
          <GrammarSubsection title="Communication style" subtitle="How you provide context per directive and how much you steer mid-flight.">
            {commLines}
          </GrammarSubsection>
        )}
        {claudeFeatureLines.length > 0 && (
          <GrammarSubsection title="Claude features in use" subtitle="Stock framings the user employs (not the user's own inventions).">
            {claudeFeatureLines}
          </GrammarSubsection>
        )}
        {miscLines.length > 0 && (
          <GrammarSubsection title="Other patterns" subtitle="Threads, rituals, and gates.">
            {miscLines}
          </GrammarSubsection>
        )}
      </div>
    </Section>
  );
}

function GrammarSubsection({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ marginBottom: 6 }}>
        <div style={{
          fontSize: 11, fontWeight: 600, color: "var(--af-text)",
          letterSpacing: "-0.01em",
        }}>{title}</div>
        <div style={{
          fontSize: 10.5, color: "var(--af-text-tertiary)",
          lineHeight: 1.45, marginTop: 1,
        }}>{subtitle}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

function renderHarnessLines(grammar: NonNullable<WeekDigestType["interaction_grammar"]>): ReactNode[] {
  const out: ReactNode[] = [];

  // Skill families take precedence — show the cohesive toolchain.
  for (const fam of grammar.skill_families ?? []) {
    out.push(
      <GrammarLine
        key={`fam-${fam.family}`}
        label={`${fam.family}-* skill family`}
        body={`${fam.total_count} loads across ${fam.members.length} skills: ${fam.members.join(", ")}.`}
        days={fam.days}
      />
    );
  }

  // Single-skill user-authored entries that aren't already covered by a family.
  const familyMembers = new Set(
    (grammar.skill_families ?? []).flatMap(f => f.members)
  );
  const standaloneSkills = grammar.user_authored_skills.filter(s => !familyMembers.has(s.skill));
  if (standaloneSkills.length > 0) {
    out.push(
      <GrammarLine
        key="standalone-skills"
        label="Other user-authored skills"
        body={standaloneSkills.slice(0, 5).map(s => `${s.skill} ×${s.count}`).join(" · ")}
        days={standaloneSkills.flatMap(s => s.days).filter((v, i, a) => a.indexOf(v) === i).sort()}
      />
    );
  }

  for (const sa of grammar.user_authored_subagents ?? []) {
    out.push(
      <div key={`sub-${sa.type}`} style={{
        padding: "10px 12px", borderRadius: 8,
        background: "var(--af-surface)",
        border: "1px solid color-mix(in srgb, var(--af-accent) 22%, var(--af-border-subtle))",
      }}>
        <div style={{
          fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase", color: "var(--af-accent)",
          marginBottom: 4,
        }}>User-authored subagent · {sa.type}</div>
        <div style={{ fontSize: 12, color: "var(--af-text)", lineHeight: 1.5 }}>
          Dispatched {sa.count} time{sa.count === 1 ? "" : "s"} on {sa.days.length} day{sa.days.length === 1 ? "" : "s"}.
        </div>
        {sa.sample_prompt_preview && (
          <div style={{
            marginTop: 6, padding: "6px 10px", borderRadius: 6,
            background: "var(--af-surface-raised)",
            borderLeft: "2px solid var(--af-accent)",
            fontSize: 11, lineHeight: 1.5, color: "var(--af-text)", fontStyle: "italic",
          }}>
            <span style={{ color: "var(--af-text-tertiary)" }}>“</span>
            {sa.sample_prompt_preview}
            <span style={{ color: "var(--af-text-tertiary)" }}>”</span>
          </div>
        )}
        {sa.days.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <DayChips dates={sa.days} tone="var(--af-accent)" />
          </div>
        )}
      </div>
    );
  }

  // Custom slash-command frame — surface here as user-authored commands the
  // user invoked (the harness's command surface).
  const slashCmd = grammar.prompt_frames.find(f => f.frame === "slash-command");
  if (slashCmd) {
    out.push(
      <GrammarLine
        key="slash-cmd"
        label="Custom slash-commands"
        body={`Invoked ${slashCmd.count} time${slashCmd.count === 1 ? "" : "s"} via <command-name> framing.`}
        days={slashCmd.days}
      />
    );
  }

  return out;
}

function renderCommunicationLines(grammar: NonNullable<WeekDigestType["interaction_grammar"]>): ReactNode[] {
  const cs = grammar.communication_style;
  if (!cs) return [];
  const out: ReactNode[] = [];

  // Verbosity histogram inline.
  const v = cs.verbosity_distribution;
  const total = v.short + v.medium + v.long + v.very_long;
  if (total > 0) {
    out.push(
      <GrammarLine
        key="verbosity"
        label="Prompt length distribution"
        body={`${v.short} short (<100c) · ${v.medium} medium (100–500c) · ${v.long} long (500–2000c) · ${v.very_long} very-long (>2000c) — across ${total} session opener${total === 1 ? "" : "s"}.`}
      />
    );
  }

  // External refs.
  if (cs.external_context_refs && cs.external_context_refs.length > 0) {
    const byKind = new Map<string, number>();
    for (const r of cs.external_context_refs) {
      byKind.set(r.ref_kind, (byKind.get(r.ref_kind) ?? 0) + 1);
    }
    const summary = [...byKind.entries()].map(([k, c]) => `${c} ${k}`).join(" · ");
    out.push(
      <GrammarLine
        key="ext-refs"
        label="External-context references"
        body={`${cs.external_context_refs.length} session opener${cs.external_context_refs.length === 1 ? "" : "s"} delegated by reference rather than spelling out the work — ${summary}.`}
        days={[...new Set(cs.external_context_refs.map(r => r.date))].sort()}
      />
    );
  }

  // Steering intensity.
  const s = cs.steering;
  if (s && (s.total_interrupts > 0 || s.total_frustrated > 0 || s.total_dissatisfied > 0)) {
    const intensity = s.total_turns > 0 ? ((s.total_interrupts / s.total_turns) * 100) : 0;
    const parts: string[] = [];
    parts.push(`${s.total_interrupts} interrupt${s.total_interrupts === 1 ? "" : "s"} across ${s.total_turns} turns (${intensity.toFixed(1)}%)`);
    if (s.total_frustrated > 0) parts.push(`${s.total_frustrated} frustrated`);
    if (s.total_dissatisfied > 0) parts.push(`${s.total_dissatisfied} dissatisfied`);
    if (s.sessions_with_mid_run_redirect > 0) parts.push(`${s.sessions_with_mid_run_redirect} session${s.sessions_with_mid_run_redirect === 1 ? "" : "s"} with ≥2 interrupts`);
    out.push(
      <GrammarLine
        key="steering"
        label="Steering intensity"
        body={parts.join(" · ")}
      />
    );
  } else if (s) {
    out.push(
      <GrammarLine
        key="steering-none"
        label="Steering intensity"
        body={`No interrupts or frustrated/dissatisfied signals across ${s.total_turns} turns — let the agent run.`}
      />
    );
  }

  return out;
}

function renderClaudeFeatureLines(grammar: NonNullable<WeekDigestType["interaction_grammar"]>): ReactNode[] {
  const out: ReactNode[] = [];
  for (const f of grammar.prompt_frames) {
    if (f.origin !== "claude-feature") continue;
    if (f.frame === "slash-command") continue;  // already shown under Harness
    const label = FRAME_LABELS[f.frame] ?? f.frame;
    const help = FRAME_HELP[f.frame] ?? "";
    out.push(
      <GrammarLine
        key={`cf-${f.frame}`}
        label={label}
        body={`${f.count} session opener${f.count === 1 ? "" : "s"}${help ? `. ${help}` : "."}`}
        days={f.days}
      />
    );
  }
  return out;
}

function renderMiscGrammarLines(grammar: NonNullable<WeekDigestType["interaction_grammar"]>): ReactNode[] {
  const out: ReactNode[] = [];

  if (grammar.brainstorming_warmup_days.length > 0) {
    out.push(
      <GrammarLine
        key="brainstorm"
        label="Brainstorming as warmup"
        body={`Loaded a brainstorming/writing-plans skill before tool use on ${grammar.brainstorming_warmup_days.length} day${grammar.brainstorming_warmup_days.length === 1 ? "" : "s"}.`}
        days={grammar.brainstorming_warmup_days}
      />
    );
  }

  // Personal-habit frames (handoff-prose).
  for (const f of grammar.prompt_frames) {
    if (f.origin !== "personal-habit") continue;
    out.push(
      <GrammarLine
        key={`ph-${f.frame}`}
        label={`${FRAME_LABELS[f.frame] ?? f.frame} (personal habit)`}
        body={`${f.count} session opener${f.count === 1 ? "" : "s"}. ${FRAME_HELP[f.frame] ?? ""}`}
        days={f.days}
      />
    );
  }

  // Threads — show all, with a "+N more" fold past 5.
  if (grammar.threads.length > 0) {
    out.push(<ThreadList key="threads" threads={grammar.threads} />);
  }

  if (grammar.todo_ops_total > 0) {
    out.push(
      <GrammarLine
        key="todo"
        label="TodoWrite ops"
        body={`${grammar.todo_ops_total} TodoWrite operations across the week — task layer as orchestration substrate.`}
      />
    );
  }

  if (grammar.plan_mode.exit_plan_calls === 0 && grammar.plan_mode.days_with_plan === 0) {
    out.push(
      <GrammarLine
        key="no-plan"
        label="Plan Mode unused"
        body="No ExitPlan calls or plan-gated sessions this week. Planning happened by other means (specs / review subagents) or not at all."
      />
    );
  } else {
    out.push(
      <GrammarLine
        key="plan-mode"
        label="Plan Mode"
        body={`${grammar.plan_mode.exit_plan_calls} ExitPlan call${grammar.plan_mode.exit_plan_calls === 1 ? "" : "s"} on ${grammar.plan_mode.days_with_plan}/7 days.`}
      />
    );
  }

  return out;
}

function ThreadList({ threads }: { threads: NonNullable<WeekDigestType["interaction_grammar"]>["threads"] }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = threads.slice().sort((a, b) => b.entries.length - a.entries.length || b.total_active_min - a.total_active_min);
  const visible = expanded ? sorted : sorted.slice(0, 5);
  const hidden = sorted.length - visible.length;
  return (
    <div style={{
      padding: "10px 12px", borderRadius: 8,
      background: "var(--af-surface)",
      border: "1px solid var(--af-border-subtle)",
    }}>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
        textTransform: "uppercase", color: "var(--af-text-tertiary)",
        marginBottom: 6,
      }}>Multi-day session threads · {threads.length}</div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {visible.map(t => {
          const dayList = t.entries.map(e => e.date).sort();
          const project = t.entries[0]?.project_display ?? "";
          return (
            <li key={t.thread_id} style={{
              fontSize: 11, color: "var(--af-text)", lineHeight: 1.5,
              fontFamily: "var(--font-mono)",
              display: "flex", gap: 8, alignItems: "baseline",
            }}>
              <span style={{ color: "var(--af-text-tertiary)" }}>{t.thread_id.slice(0, 8)}</span>
              <span style={{ color: "var(--af-text-secondary)" }}>{project}</span>
              <span style={{ color: "var(--af-text)" }}>{dayList.length}d · {Math.round(t.total_active_min)}m</span>
              <span style={{ color: "var(--af-text-tertiary)" }}>{dayList[0]} → {dayList[dayList.length - 1]}</span>
              {t.outcome && <span style={{ color: "var(--af-text-secondary)" }}>· {t.outcome}</span>}
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            marginTop: 6, padding: "3px 8px", borderRadius: 4,
            background: "transparent", border: "1px solid var(--af-border-subtle)",
            fontSize: 10, color: "var(--af-text-secondary)", cursor: "pointer",
            fontFamily: "var(--font-mono)",
          }}
        >+{hidden} more</button>
      )}
      {expanded && sorted.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          style={{
            marginTop: 6, padding: "3px 8px", borderRadius: 4,
            background: "transparent", border: "1px solid var(--af-border-subtle)",
            fontSize: 10, color: "var(--af-text-secondary)", cursor: "pointer",
            fontFamily: "var(--font-mono)",
          }}
        >show less</button>
      )}
    </div>
  );
}

function GrammarLine({
  label, body, days,
}: { label: string; body: string; days?: string[] }) {
  return (
    <div style={{
      padding: "10px 12px", borderRadius: 8,
      background: "var(--af-surface)",
      border: "1px solid var(--af-border-subtle)",
    }}>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
        textTransform: "uppercase", color: "var(--af-text-tertiary)",
        marginBottom: 4,
      }}>{label}</div>
      <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--af-text)" }}>{body}</div>
      {days && days.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <DayChips dates={days} tone="var(--af-accent)" />
        </div>
      )}
    </div>
  );
}

function FindingsSection({
  title, anchor, items, tone, sectionFallbackProse,
}: {
  title: string;
  anchor: string;
  items: NonNullable<WeekDigestType["what_worked"]>;
  tone: string;
  sectionFallbackProse: string | null;
}) {
  if (!items || items.length === 0) {
    if (sectionFallbackProse === null) return null;
    return (
      <Section title={title} anchor={anchor}>
        <p style={{
          fontSize: 12, fontStyle: "italic",
          color: "var(--af-text-tertiary)",
          margin: 0, padding: "8px 0",
        }}>{sectionFallbackProse}</p>
      </Section>
    );
  }
  return (
    <Section title={title} anchor={anchor}>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item, i) => (
          <FindingCard key={i} item={item} tone={tone} />
        ))}
      </ul>
    </Section>
  );
}

function FindingCard({
  item, tone,
}: {
  item: NonNullable<WeekDigestType["what_worked"]>[number];
  tone: string;
}) {
  const anchorLabel = renderAnchor(item.anchor);
  return (
    <li style={{
      padding: "12px 14px", borderRadius: 10,
      background: `color-mix(in srgb, ${tone} 6%, var(--af-surface))`,
      border: `1px solid color-mix(in srgb, ${tone} 22%, var(--af-border))`,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{
          fontSize: 13, fontWeight: 600, color: "var(--af-text)",
          letterSpacing: "-0.01em", flex: 1, minWidth: 0,
        }}>{item.title}</span>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
          textTransform: "uppercase", color: tone,
          padding: "1px 7px", borderRadius: 999,
          background: `color-mix(in srgb, ${tone} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${tone} 28%, transparent)`,
          fontFamily: "var(--font-mono)",
        }} title={`Anchor: ${item.anchor}`}>{anchorLabel}</span>
      </div>
      <p style={{ fontSize: 12, lineHeight: 1.6, margin: "0 0 8px", color: "var(--af-text)" }}>
        {item.detail}
      </p>
      <div style={{
        padding: "6px 10px", borderRadius: 6,
        background: "var(--af-surface-raised)",
        borderLeft: `2px solid color-mix(in srgb, ${tone} 50%, transparent)`,
        display: "flex", gap: 8, alignItems: "flex-start",
      }}>
        <Link href={`/digest/${item.evidence.date}`} style={{
          fontSize: 10, fontWeight: 600, color: tone,
          fontFamily: "var(--font-mono)", flexShrink: 0,
          textDecoration: "none", paddingTop: 2,
        }}>
          {dayName(item.evidence.date)} {item.evidence.date.slice(5)}
        </Link>
        <span style={{ fontSize: 11, lineHeight: 1.5, color: "var(--af-text)", fontStyle: "italic" }}>
          <span style={{ color: "var(--af-text-tertiary)" }}>“</span>
          {item.evidence.quote}
          <span style={{ color: "var(--af-text-tertiary)" }}>”</span>
        </span>
      </div>
    </li>
  );
}

function renderAnchor(anchor: string): string {
  if (anchor === "plan-mode-gap") return "Plan-mode gap";
  if (anchor.startsWith("interaction_grammar.")) {
    const k = anchor.slice("interaction_grammar.".length);
    return k.replace(/_/g, " ");
  }
  return SHAPE_LABELS[anchor] ?? anchor;
}

function SurprisesSection({
  items,
}: {
  items: NonNullable<WeekDigestType["what_surprised"]>;
}) {
  if (!items || items.length === 0) return null;
  return (
    <Section title="What surprised" anchor="what-surprised">
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item, i) => {
          const tone = "#b794f4";
          return (
            <li key={i} style={{
              padding: "12px 14px", borderRadius: 10,
              background: `color-mix(in srgb, ${tone} 6%, var(--af-surface))`,
              border: `1px solid color-mix(in srgb, ${tone} 22%, var(--af-border))`,
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                <span style={{
                  fontSize: 13, fontWeight: 600, color: "var(--af-text)",
                  letterSpacing: "-0.01em", flex: 1, minWidth: 0,
                }}>{item.title}</span>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
                  textTransform: "uppercase", color: tone,
                  padding: "1px 7px", borderRadius: 999,
                  background: `color-mix(in srgb, ${tone} 14%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${tone} 28%, transparent)`,
                  fontFamily: "var(--font-mono)",
                }}>{SURPRISE_LABELS[item.surprise_kind] ?? item.surprise_kind}</span>
              </div>
              <p style={{ fontSize: 12, lineHeight: 1.6, margin: "0 0 8px", color: "var(--af-text)" }}>
                {item.detail}
              </p>
              <div style={{
                padding: "6px 10px", borderRadius: 6,
                background: "var(--af-surface-raised)",
                borderLeft: `2px solid color-mix(in srgb, ${tone} 50%, transparent)`,
                display: "flex", gap: 8, alignItems: "flex-start",
              }}>
                <Link href={`/digest/${item.evidence.date}`} style={{
                  fontSize: 10, fontWeight: 600, color: tone,
                  fontFamily: "var(--font-mono)", flexShrink: 0,
                  textDecoration: "none", paddingTop: 2,
                }}>
                  {dayName(item.evidence.date)} {item.evidence.date.slice(5)}
                </Link>
                <span style={{ fontSize: 11, lineHeight: 1.5, color: "var(--af-text)", fontStyle: "italic" }}>
                  <span style={{ color: "var(--af-text-tertiary)" }}>“</span>
                  {item.evidence.quote}
                  <span style={{ color: "var(--af-text-tertiary)" }}>”</span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function WhereToLeanSection({
  items,
}: {
  items: NonNullable<WeekDigestType["where_to_lean"]>;
}) {
  if (!items || items.length === 0) return null;
  return (
    <Section title="Where to lean" anchor="where-to-lean">
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((item, i) => {
          const tone = "var(--af-accent)";
          const anchorLabel = renderAnchor(item.anchor);
          return (
            <li key={i} style={{
              padding: "14px 16px", borderRadius: 10,
              background: "var(--af-surface)",
              border: "1px solid var(--af-border-subtle)",
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
                  textTransform: "uppercase", color: tone,
                  padding: "1px 7px", borderRadius: 999,
                  background: `color-mix(in srgb, ${tone} 14%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${tone} 28%, transparent)`,
                  fontFamily: "var(--font-mono)",
                }}>{LEAN_KIND_LABELS[item.lean_kind] ?? item.lean_kind}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--af-text)", flex: 1, minWidth: 0 }}>
                  {item.title}
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
                  textTransform: "uppercase", color: "var(--af-text-tertiary)",
                  fontFamily: "var(--font-mono)",
                }} title={`Anchor: ${item.anchor}`}>↳ {anchorLabel}</span>
              </div>
              <p style={{ fontSize: 12, lineHeight: 1.6, margin: "0 0 10px", color: "var(--af-text)" }}>
                {item.detail}
              </p>
              {item.copyable && (
                <CopyBlock label={`Copy ${item.lean_kind === "claude-md" ? "block" : "snippet"}`} payload={item.copyable} />
              )}
              <div style={{
                marginTop: 8, fontSize: 10, color: "var(--af-text-tertiary)",
                fontFamily: "var(--font-mono)",
              }}>
                Evidence · <Link href={`/digest/${item.evidence.date}`} style={{ color: "var(--af-text-tertiary)", textDecoration: "underline" }}>
                  {dayName(item.evidence.date)} {item.evidence.date.slice(5)}
                </Link> · “{item.evidence.quote.slice(0, 100)}{item.evidence.quote.length > 100 ? "…" : ""}”
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function Section({ title, anchor, children }: { title: string; anchor?: string; children: ReactNode }) {
  return (
    <section id={anchor} style={{ marginBottom: 28, scrollMarginTop: 24 }}>
      <h2 style={sectionTitleStyle()}>{title}</h2>
      {children}
    </section>
  );
}

function sectionTitleStyle(): React.CSSProperties {
  return {
    fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
    textTransform: "uppercase", color: "var(--af-text-tertiary)",
    margin: "0 0 12px",
  };
}

function cardStyle(): React.CSSProperties {
  return {
    padding: "12px 14px", borderRadius: 8,
    background: "var(--af-surface)",
    border: "1px solid var(--af-border-subtle)",
  };
}

function dayName(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

function formatRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(s)} – ${fmt(e)}`;
}

// ─── Top sessions section ─────────────────────────────────────────────────

const PIN_COLORS: Record<string, string> = {
  "user-steering":     "#ed8936",
  "subagent-burst":    "#9f7aea",
  "long-autonomous":   "#4299e1",
  "plan-mode":         "#38b2ac",
  "pr-ship":           "#48bb78",
  "harness-chain":     "#ed64a6",
  "interrupt":         "#f56565",
  "brainstorm-loop":   "#9f7aea",
  "agent-loop":        "#f56565",
};

const PIN_LABELS: Record<string, string> = {
  "user-steering":     "Steering",
  "subagent-burst":    "Subagents",
  "long-autonomous":   "Autonomous",
  "plan-mode":         "Plan",
  "pr-ship":           "Shipped",
  "harness-chain":     "Harness",
  "interrupt":         "Interrupt",
  "brainstorm-loop":   "Brainstorm",
  "agent-loop":        "Loop",
};

function TopSessionsSection({ sessions }: { sessions: WeekTopSession[] }) {
  return (
    <Section title={`Top ${sessions.length} session${sessions.length === 1 ? "" : "s"} this week`} anchor="top-sessions">
      <p style={{
        fontSize: 12, color: "var(--af-text-tertiary)", marginTop: -4,
        marginBottom: 14, fontStyle: "italic", lineHeight: 1.5, maxWidth: 720,
      }}>
        Picked by significance — active time × subagents × ships, capped to one per project. Each card walks the timeline with annotated moments to surface the texture of how you drove the agent.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {sessions.map(s => <TopSessionCard key={s.session_id} session={s} />)}
      </div>
    </Section>
  );
}

function TopSessionCard({ session }: { session: WeekTopSession }) {
  const shapeLabel = session.working_shape ? (SHAPE_LABELS[session.working_shape] ?? session.working_shape) : null;
  const shapeColor = session.working_shape ? (SHAPE_COLORS[session.working_shape] ?? "var(--af-text-tertiary)") : "var(--af-text-tertiary)";
  const wallH = session.wall_min / 60;
  const activeH = session.active_min / 60;
  const wallStr = wallH >= 1 ? `${wallH.toFixed(1)}h wall` : `${Math.round(session.wall_min)}m wall`;
  const activeStr = activeH >= 1 ? `${activeH.toFixed(1)}h active` : `${Math.round(session.active_min)}m active`;

  return (
    <div style={{
      borderRadius: 10,
      background: "var(--af-surface)",
      border: "1px solid var(--af-border-subtle)",
      borderTop: `3px solid ${shapeColor}`,
      overflow: "hidden",
    }}>
      <div style={{ padding: "16px 18px" }}>
        {/* Header row */}
        <div style={{
          display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap",
          marginBottom: 6,
        }}>
          <Link
            href={`/sessions/${session.session_id}`}
            style={{
              fontSize: 14, fontWeight: 600, color: "var(--af-text)",
              letterSpacing: "-0.01em", textDecoration: "none",
            }}
          >
            {session.project_display}
          </Link>
          <AgentBadge agent={session.agent} />
          <Link
            href={`/digest/${session.date}`}
            style={{
              fontSize: 11, fontFamily: "var(--font-mono)",
              color: "var(--af-accent)", textDecoration: "none",
            }}
          >
            {dayName(session.date)} {session.date.slice(5)}
          </Link>
          <span style={{
            fontSize: 11, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)",
          }}>
            {activeStr} · {wallStr} · {session.turn_count} turns
          </span>
          {shapeLabel && (
            <span style={{
              padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 600,
              background: `color-mix(in srgb, ${shapeColor} 14%, transparent)`,
              color: shapeColor,
            }}>
              {shapeLabel}
            </span>
          )}
          {session.outcome === "shipped" && session.shipped_prs.length > 0 && (
            <span style={{
              padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 600,
              background: "color-mix(in srgb, #48bb78 14%, transparent)",
              color: "#48bb78",
            }}>
              ✓ {session.shipped_prs.length} PR{session.shipped_prs.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {/* day_signature italic subhead */}
        {session.day_signature && (
          <p style={{
            fontSize: 12, fontStyle: "italic", color: "var(--af-text-secondary)",
            margin: "0 0 14px", lineHeight: 1.5, maxWidth: 760,
          }}>
            “{session.day_signature}”
          </p>
        )}

        {/* Structured deep-dive: why-picked / what-happened / what-worked / what-hit-friction */}
        <NarrativeBlock session={session} />

        {/* Steering summary */}
        {session.steering_summary && (
          <p style={{
            fontSize: 12, lineHeight: 1.55, margin: "10px 0 12px",
            color: "var(--af-text-secondary)", maxWidth: 780,
            paddingLeft: 10, borderLeft: "2px solid var(--af-border-subtle)",
          }}>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
              textTransform: "uppercase", color: "var(--af-text-tertiary)",
              marginRight: 6,
            }}>steering</span>
            {session.steering_summary}
          </p>
        )}

        {/* Harness signature chips */}
        <HarnessChips session={session} />

        {/* Timeline minimap */}
        <SessionTimelineMinimap session={session} />

        {/* Pin list */}
        {session.pins.length > 0 && (
          <ol style={{
            listStyle: "none", padding: 0, margin: "12px 0 0",
            display: "flex", flexDirection: "column", gap: 6,
          }}>
            {session.pins.map((pin, i) => <PinRow key={i} pin={pin} />)}
          </ol>
        )}
      </div>
    </div>
  );
}

function NarrativeBlock({ session }: { session: WeekTopSession }) {
  // Backward-compat: cached pre-refactor digests only have session_summary.
  // Render the new structured fields when present; fall back to the old
  // single summary otherwise.
  const hasStructured = session.why_picked || session.what_worked || session.what_hit_friction;
  if (!hasStructured) {
    if (!session.session_summary) return null;
    return (
      <p style={{
        fontSize: 13, lineHeight: 1.55, margin: "0 0 8px",
        color: "var(--af-text)", maxWidth: 780,
      }}>
        {session.session_summary}
      </p>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "0 0 6px" }}>
      {session.why_picked && (
        <NarrativeRow
          label="Why this session"
          tone="var(--af-text-tertiary)"
          accent="var(--af-text-tertiary)"
          text={session.why_picked}
        />
      )}
      {session.session_summary && (
        <NarrativeRow
          label="What happened"
          tone="var(--af-text)"
          accent="var(--af-text-secondary)"
          text={session.session_summary}
          weight={500}
        />
      )}
      {session.what_worked && (
        <NarrativeRow
          label="What worked"
          tone="var(--af-text)"
          accent="#48bb78"
          text={session.what_worked}
        />
      )}
      {session.what_hit_friction && (
        <NarrativeRow
          label="What hit friction"
          tone="var(--af-text)"
          accent="#ed8936"
          text={session.what_hit_friction}
        />
      )}
    </div>
  );
}

function NarrativeRow({ label, tone, accent, text, weight = 400 }: {
  label: string;
  tone: string;
  accent: string;
  text: string;
  weight?: number;
}) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", maxWidth: 800 }}>
      <span style={{
        flexShrink: 0, width: 132, paddingTop: 2,
        fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em",
        textTransform: "uppercase", color: accent,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 13, lineHeight: 1.55, color: tone, fontWeight: weight,
      }}>
        {text}
      </span>
    </div>
  );
}

function HarnessChips({ session }: { session: WeekTopSession }) {
  const { user_authored_skills, user_authored_subagents, stock_skills, top_tools } = session;
  const hasAny = user_authored_skills.length > 0 || user_authored_subagents.length > 0
    || stock_skills.length > 0 || top_tools.length > 0;
  if (!hasAny) return null;
  return (
    <div style={{ marginBottom: 4 }}>
      {user_authored_subagents.length > 0 && (
        <ChipRow label="Your subagents">
          {user_authored_subagents.map(sa => (
            <Chip key={sa.type} tone="user">
              {sa.type}{sa.count > 1 ? ` ×${sa.count}` : ""}
            </Chip>
          ))}
        </ChipRow>
      )}
      {(user_authored_skills.length > 0 || stock_skills.length > 0) && (
        <ChipRow label="Skills loaded">
          {user_authored_skills.map(s => (<Chip key={s} tone="user">{s}</Chip>))}
          {stock_skills.slice(0, 6).map(s => (<Chip key={s} tone="stock">{s}</Chip>))}
        </ChipRow>
      )}
      {top_tools.length > 0 && (
        <ChipRow label="Top tools">
          {top_tools.slice(0, 4).map((t, i) => (<Chip key={i}>{t}</Chip>))}
        </ChipRow>
      )}
    </div>
  );
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
      padding: "3px 0", fontSize: 11,
    }}>
      <span style={{
        minWidth: 96, color: "var(--af-text-tertiary)", fontWeight: 500,
        fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em",
      }}>
        {label}
      </span>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", flex: 1 }}>{children}</div>
    </div>
  );
}

function Chip({ children, tone, title }: { children: ReactNode; tone?: "user" | "stock"; title?: string }) {
  const bg = tone === "user" ? "var(--af-accent-subtle)" : "var(--af-border-subtle)";
  const fg = tone === "user" ? "var(--af-accent)" : "var(--af-text-secondary)";
  return (
    <span title={title} style={{
      display: "inline-flex", alignItems: "center", padding: "2px 8px",
      borderRadius: 999, fontSize: 10, fontFamily: "var(--font-mono)",
      background: bg, color: fg, whiteSpace: "nowrap",
      maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis",
    }}>
      {children}
    </span>
  );
}

function SessionTimelineMinimap({ session }: { session: WeekTopSession }) {
  const intervals = session.timeline.active_intervals;
  // Compute the actual span the bars cover so we never clip an interval off
  // the right edge. Older cached digests stored duration_min as active_min
  // while intervals are positioned in wall-clock minutes — taking max() of
  // both makes the renderer correct regardless of which convention the
  // cached digest used.
  const observedMax = intervals.length > 0
    ? Math.max(...intervals.map(iv => iv.end_min))
    : 0;
  const duration = Math.max(1, session.timeline.duration_min, observedMax);
  return (
    <div style={{ marginTop: 10, marginBottom: 4 }}>
      <div style={{
        position: "relative", width: "100%", height: 28,
        background: "var(--af-border-subtle)", borderRadius: 4,
      }}>
        {/* Active intervals */}
        {intervals.map((iv, i) => {
          const left = (iv.start_min / duration) * 100;
          const width = Math.max(0.6, ((iv.end_min - iv.start_min) / duration) * 100);
          return (
            <div key={i} style={{
              position: "absolute", top: 6, bottom: 6,
              left: `${left}%`, width: `${width}%`,
              background: "color-mix(in srgb, var(--af-accent) 30%, transparent)",
              borderRadius: 2,
            }} />
          );
        })}
        {/* Pins */}
        {session.pins.map((pin, i) => {
          const left = Math.max(0, Math.min(100, (pin.start_min / duration) * 100));
          const right = pin.end_min !== undefined
            ? Math.max(left + 0.5, Math.min(100, (pin.end_min / duration) * 100))
            : left;
          const isSpan = pin.end_min !== undefined && right > left + 0.5;
          const color = PIN_COLORS[pin.kind] ?? "var(--af-accent)";
          return (
            <div key={i}>
              {isSpan && (
                <div style={{
                  position: "absolute", top: 4, bottom: 4,
                  left: `${left}%`, width: `${right - left}%`,
                  background: `color-mix(in srgb, ${color} 35%, transparent)`,
                  border: `1px solid ${color}`,
                  borderRadius: 3,
                }} title={`${PIN_LABELS[pin.kind]}: ${pin.label}`} />
              )}
              <div style={{
                position: "absolute", top: -3, bottom: -3,
                left: `${left}%`, width: 3,
                background: color,
                borderRadius: 1,
                transform: "translateX(-1.5px)",
              }} title={`${PIN_LABELS[pin.kind]}: ${pin.label}`} />
            </div>
          );
        })}
      </div>
      {/* Min markers — wall-clock from session start; teal bars are active
          intervals, gaps are idle periods (>3min between events). */}
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontSize: 9, fontFamily: "var(--font-mono)",
        color: "var(--af-text-tertiary)",
        marginTop: 3,
      }}>
        <span>0m</span>
        <span>{formatMin(duration / 2)}</span>
        <span>{formatMin(duration)} wall</span>
      </div>
    </div>
  );
}

function PinRow({ pin }: { pin: SessionPin }) {
  const color = PIN_COLORS[pin.kind] ?? "var(--af-accent)";
  const isSpan = pin.end_min !== undefined && pin.end_min > pin.start_min + 0.5;
  const t = isSpan
    ? `${formatMin(pin.start_min)}–${formatMin(pin.end_min!)}`
    : formatMin(pin.start_min);
  return (
    <li style={{
      display: "flex", gap: 10, alignItems: "flex-start",
      fontSize: 12, lineHeight: 1.5,
    }}>
      <span style={{
        flexShrink: 0, width: 3, height: 3, marginTop: 7,
        borderRadius: 999, background: color,
      }} />
      <span style={{
        flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 10,
        color: "var(--af-text-tertiary)", paddingTop: 1, minWidth: 60,
      }}>
        {t}
      </span>
      <span style={{
        flexShrink: 0, padding: "1px 7px", borderRadius: 999, fontSize: 9,
        fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        color: color, marginTop: 1,
      }}>
        {PIN_LABELS[pin.kind] ?? pin.kind}
      </span>
      <span style={{ color: "var(--af-text)", maxWidth: 640 }}>
        {pin.label}
      </span>
    </li>
  );
}

function formatMin(m: number): string {
  if (m >= 60) {
    // Round to whole minutes first, THEN split into hours+minutes — otherwise
    // a value like 179.6 rounds to "2h 60m" because Math.round(179.6 % 60)
    // wraps to 60 without bumping the hour.
    const total = Math.round(m);
    const h = Math.floor(total / 60);
    const min = total % 60;
    return `${h}h${min > 0 ? ` ${min}m` : ""}`;
  }
  return `${Math.round(m * 10) / 10}m`;
}

// ─── Pattern rollups fold-down (replaces inline working_shapes + grammar) ─

function PatternRollupsFold({
  shapes, grammar,
}: {
  shapes: WeekDigestType["working_shapes"];
  grammar: WeekDigestType["interaction_grammar"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <section style={{ marginBottom: 28 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "transparent", border: "none", cursor: "pointer",
          padding: "6px 0", color: "var(--af-text-tertiary)",
          fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {open ? "▾" : "▸"} Weekly pattern rollups
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {shapes && shapes.length > 0 && <WorkingShapesSection shapes={shapes} />}
          {grammar && <InteractionGrammarSection grammar={grammar} />}
        </div>
      )}
    </section>
  );
}

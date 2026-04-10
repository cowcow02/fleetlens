/**
 * Dashboard home — high-level metrics across all Claude Code sessions.
 *
 * Everything here is server-rendered from @claude-lens/parser/fs, then
 * passed down to small interactive client components (heatmap, chart).
 */

import {
  dailyActivity,
  detectParallelRuns,
  groupByProject,
  highLevelMetrics,
  type SessionMeta,
} from "@claude-lens/parser";
import { Heatmap } from "@/components/heatmap";
import { ActivityChart } from "@/components/activity-chart";
import { MetricCard } from "@/components/metric-card";
import { ParallelRunsStrip } from "@/components/parallel-runs-strip";
import { DateRangeFilter } from "@/components/date-range-filter";
import { LiveBadge } from "@/components/live-badge";
import { cutoffMs, parseRange } from "@/lib/date-range";
import { listSessions } from "@/lib/data";
import { formatDuration, formatTokens, formatRelative, prettyProjectName, estimateCost, estimateCostMulti, formatCost } from "@/lib/format";
import { ListTree, Activity, Clock, Zap, DollarSign } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

function filterByRange<T extends SessionMeta>(sessions: T[], cutoff: number | undefined): T[] {
  if (cutoff === undefined) return sessions;
  return sessions.filter((s) => {
    if (!s.firstTimestamp) return false;
    const ms = Date.parse(s.firstTimestamp);
    return !Number.isNaN(ms) && ms >= cutoff;
  });
}

export default async function DashboardHome({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rangeParam } = await searchParams;
  const range = parseRange(rangeParam);
  const cutoff = cutoffMs(range);

  const allSessions = await listSessions();
  const sessions = filterByRange(allSessions, cutoff);

  const metrics = highLevelMetrics(sessions);
  const buckets = dailyActivity(sessions);
  const parallelRuns = detectParallelRuns(sessions, 2);
  // Top projects: session count desc with token count as tiebreaker.
  const projects = groupByProject(sessions)
    .sort((a, b) => {
      const byCount = b.metrics.sessionCount - a.metrics.sessionCount;
      if (byCount !== 0) return byCount;
      const aTokens =
        a.metrics.totalTokens.input +
        a.metrics.totalTokens.output +
        a.metrics.totalTokens.cacheRead;
      const bTokens =
        b.metrics.totalTokens.input +
        b.metrics.totalTokens.output +
        b.metrics.totalTokens.cacheRead;
      return bTokens - aTokens;
    })
    .slice(0, 8);

  const totalInput =
    metrics.totalTokens.input + metrics.totalTokens.cacheRead + metrics.totalTokens.cacheWrite;

  const LIVE_WINDOW_MS = 45_000;
  const now = Date.now();
  const liveSessions = sessions.filter((s) => {
    if (!s.lastTimestamp) return false;
    const ms = Date.parse(s.lastTimestamp);
    return !Number.isNaN(ms) && now - ms <= LIVE_WINDOW_MS;
  });
  const liveIds = new Set(liveSessions.map((s) => s.id));
  const recentSessions = sessions.filter((s) => !liveIds.has(s.id)).slice(0, 6);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 28,
        maxWidth: 1280,
        padding: "32px 40px",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 18,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
            Overview
          </h1>
          <p style={{ fontSize: 13, color: "var(--af-text-secondary)", marginTop: 4 }}>
            {sessions.length} of {allSessions.length} session
            {allSessions.length === 1 ? "" : "s"}, read from{" "}
            <code
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                background: "var(--af-border-subtle)",
                padding: "1px 6px",
                borderRadius: 4,
              }}
            >
              ~/.claude/projects
            </code>
            .
          </p>
        </div>
        <DateRangeFilter current={range} />
      </header>

      {/* Live sessions */}
      {liveSessions.length > 0 && (
        <section
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(liveSessions.length, 3)}, 1fr)`,
            gap: 12,
          }}
        >
          {liveSessions.map((s) => (
            <Link
              key={`${s.projectDir}/${s.id}`}
              href={`/sessions/${s.id}`}
              className="af-panel"
              style={{
                display: "block",
                padding: "16px 20px",
                borderLeft: "3px solid #ef4444",
                transition: "border-color 0.15s",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <LiveBadge mtimeIso={s.lastTimestamp} size="md" />
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--af-text-tertiary)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {prettyProjectName(s.projectName)}
                </span>
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--af-text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  lineHeight: 1.4,
                }}
              >
                {s.firstUserPreview || (
                  <em style={{ color: "var(--af-text-tertiary)" }}>(no user message)</em>
                )}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--af-text-secondary)",
                  marginTop: 6,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={s.lastAgentPreview}
              >
                {s.lastAgentPreview || <em style={{ color: "var(--af-text-tertiary)" }}>—</em>}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 16,
                  marginTop: 10,
                  fontSize: 10,
                  color: "var(--af-text-tertiary)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                <span>{s.turnCount ?? 0} turns</span>
                <span>{formatDuration(s.airTimeMs ?? s.durationMs)}</span>
                <span>{s.toolCallCount ?? 0} tools</span>
              </div>
            </Link>
          ))}
        </section>
      )}

      {/* Metric cards */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
        }}
      >
        <MetricCard
          label="Sessions"
          value={metrics.sessionCount.toLocaleString()}
          sub={`${metrics.totalTurns.toLocaleString()} turns total`}
          icon={<ListTree size={13} />}
          tooltip="Total Claude Code sessions (one JSONL file = one session). A 'turn' is one user message that starts an agent response cycle."
        />
        <MetricCard
          label="Active time"
          value={formatDuration(metrics.totalAirTimeMs)}
          sub={
            buckets.filter((b) => b.airTimeMs > 0).length > 0
              ? `avg ${formatDuration(
                  metrics.totalAirTimeMs /
                    Math.max(1, buckets.filter((b) => b.airTimeMs > 0).length),
                )} / active day`
              : "no activity"
          }
          icon={<Clock size={13} />}
          tooltip="Sum of time the agent was actively working across all sessions. Gaps longer than 3 minutes (user away, laptop lid closed) are excluded. This is NOT wall-clock duration."
        />
        <MetricCard
          label="Tool calls"
          value={metrics.totalToolCalls.toLocaleString()}
          sub={`avg ${metrics.sessionCount ? Math.round(metrics.totalToolCalls / metrics.sessionCount) : 0} / session`}
          icon={<Zap size={13} />}
          tooltip="Total tool invocations (Bash, Read, Edit, Write, Grep, Glob, Agent, etc.) across all sessions. Higher counts typically mean more complex tasks."
        />
        <MetricCard
          label="Est. cost"
          value={formatCost(estimateCostMulti(sessions))}
          sub={`${formatTokens(totalInput)} in · ${formatTokens(metrics.totalTokens.output)} out`}
          icon={<DollarSign size={13} />}
          tooltip={`Estimated API spend based on each session's primary model.\nUpper bound — mixed-model sessions (e.g. Opus + Haiku tools) are priced at the primary model's rate.\nFor precise costs, use ccusage.\nInput: ${formatTokens(metrics.totalTokens.input)}\nOutput: ${formatTokens(metrics.totalTokens.output)}\nCache read: ${formatTokens(metrics.totalTokens.cacheRead)}\nCache write: ${formatTokens(metrics.totalTokens.cacheWrite)}`}
        />
        <MetricCard
          label="Code changes"
          value={
            <span>
              <span style={{ color: "var(--af-success)" }}>
                +{metrics.totalLinesAdded.toLocaleString()}
              </span>
              {" "}
              <span style={{ color: "var(--af-danger)" }}>
                -{metrics.totalLinesRemoved.toLocaleString()}
              </span>
            </span>
          }
          sub={`${metrics.totalFilesEdited.toLocaleString()} files edited`}
          tooltip="Total lines added and removed across all Edit + Write tool calls. Files counted are unique file paths touched by the agent."
        />
        <MetricCard
          label="Parallel peaks"
          value={parallelRuns.length > 0 ? String(Math.max(...parallelRuns.map((r) => r.peak))) : "—"}
          sub={`${parallelRuns.length} intervals`}
          tooltip="Maximum number of Claude Code sessions running simultaneously. Detected via sweep-line over session start/end intervals. Useful for measuring multi-agent fleet parallelism."
        />
      </section>

      {/* Heatmap + Daily activity — side by side */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 2fr",
          gap: 16,
        }}
      >
        <div className="af-panel">
          <div className="af-panel-header">
            <span>Contribution heatmap</span>
            <span style={{ fontSize: 11, color: "var(--af-text-tertiary)", fontWeight: 400 }}>
              sessions / day
            </span>
          </div>
          <div style={{ padding: 18 }}>
            <Heatmap buckets={buckets} valueKey="sessions" />
          </div>
        </div>

        <div className="af-panel">
          <div className="af-panel-header">
            <span>Daily activity</span>
            <span style={{ fontSize: 11, color: "var(--af-text-tertiary)", fontWeight: 400 }}>
              click a metric to switch
            </span>
          </div>
          <div style={{ padding: 18 }}>
            <ActivityChart buckets={buckets} />
          </div>
        </div>
      </section>

      {/* Parallel runs + Top projects */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}
      >
        <div className="af-panel">
          <div className="af-panel-header">
            <span>Parallel runs</span>
            <span style={{ fontSize: 11, color: "var(--af-text-tertiary)", fontWeight: 400 }}>
              ≥ 2 concurrent sessions
            </span>
          </div>
          <div style={{ padding: 14 }}>
            <ParallelRunsStrip runs={parallelRuns} />
          </div>
        </div>

        <div className="af-panel">
          <div className="af-panel-header">
            <span>Top projects</span>
            <span style={{ fontSize: 11, color: "var(--af-text-tertiary)", fontWeight: 400 }}>
              by session count
            </span>
            <Link
              href="/projects"
              style={{ fontSize: 11, color: "var(--af-accent)", marginLeft: "auto" }}
            >
              View all →
            </Link>
          </div>
          <div>
            {projects.length === 0 ? (
              <div className="af-empty">No projects yet.</div>
            ) : (
              projects.map((p) => {
                const tokens =
                  p.metrics.totalTokens.input +
                  p.metrics.totalTokens.output +
                  p.metrics.totalTokens.cacheRead +
                  p.metrics.totalTokens.cacheWrite;
                return (
                  <Link
                    key={p.projectDir}
                    href={`/projects/${encodeURIComponent(p.projectDir)}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto auto auto",
                      gap: 14,
                      padding: "10px 18px",
                      fontSize: 12,
                      borderBottom: "1px solid var(--af-border-subtle)",
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: "var(--af-text)",
                      }}
                      title={p.projectName}
                    >
                      {prettyProjectName(p.projectName)}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--af-text-tertiary)",
                        fontFamily: "var(--font-mono)",
                        minWidth: 64,
                        textAlign: "right",
                      }}
                    >
                      {p.sessions.length} sess
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--af-text-tertiary)",
                        fontFamily: "var(--font-mono)",
                        minWidth: 52,
                        textAlign: "right",
                      }}
                      title={`${tokens.toLocaleString()} tokens`}
                    >
                      {formatTokens(tokens)}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--af-text-tertiary)",
                        minWidth: 56,
                        textAlign: "right",
                      }}
                      suppressHydrationWarning
                    >
                      {p.lastActiveMs
                        ? formatRelative(new Date(p.lastActiveMs).toISOString())
                        : "—"}
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      </section>

      {/* Recent sessions */}
      <section className="af-panel">
        <div className="af-panel-header">
          <span>Recent sessions</span>
          <Link href="/sessions" style={{ fontSize: 11, color: "var(--af-accent)" }}>
            View all →
          </Link>
        </div>
        <div>
          {recentSessions.length === 0 ? (
            <div className="af-empty">No sessions found in ~/.claude/projects</div>
          ) : (
            recentSessions.map((s) => (
              <Link
                key={`${s.projectDir}/${s.id}`}
                href={`/sessions/${s.id}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 1fr 90px 90px",
                  gap: 14,
                  padding: "12px 18px",
                  fontSize: 12,
                  borderBottom: "1px solid var(--af-border-subtle)",
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "var(--af-text)",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <LiveBadge mtimeIso={s.lastTimestamp} />
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.firstUserPreview || (
                        <em style={{ color: "var(--af-text-tertiary)" }}>(no user message)</em>
                      )}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--af-text-tertiary)",
                      marginTop: 2,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {prettyProjectName(s.projectName)}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--af-text-secondary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={s.lastAgentPreview}
                >
                  {s.lastAgentPreview || <em style={{ color: "var(--af-text-tertiary)" }}>—</em>}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--af-text-tertiary)",
                    fontFamily: "var(--font-mono)",
                    textAlign: "right",
                  }}
                  title="Active time (filters out idle gaps)"
                >
                  {formatDuration(s.airTimeMs ?? s.durationMs)}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--af-text-tertiary)",
                    textAlign: "right",
                  }}
                >
                  {s.firstTimestamp ? formatRelative(s.firstTimestamp) : "—"}
                </div>
              </Link>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

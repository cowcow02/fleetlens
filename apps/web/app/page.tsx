/**
 * Dashboard home — high-level metrics across all Claude Code sessions.
 *
 * Everything here is server-rendered from @claude-sessions/parser/fs, then
 * passed down to small interactive client components (heatmap, chart).
 */

import {
  dailyActivity,
  detectParallelRuns,
  groupByProject,
  highLevelMetrics,
} from "@claude-sessions/parser";
import { Heatmap } from "@/components/heatmap";
import { ActivityChart } from "@/components/activity-chart";
import { MetricCard } from "@/components/metric-card";
import { ParallelRunsStrip } from "@/components/parallel-runs-strip";
import { listSessions } from "@/lib/data";
import { formatDuration, formatTokens, formatRelative, prettyProjectName } from "@/lib/format";
import { ListTree, Activity, Clock, Zap } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardHome() {
  const sessions = await listSessions();
  const metrics = highLevelMetrics(sessions);
  const buckets = dailyActivity(sessions);
  const parallelRuns = detectParallelRuns(sessions, 2);
  const projects = groupByProject(sessions).slice(0, 8);

  const totalInput =
    metrics.totalTokens.input + metrics.totalTokens.cacheRead + metrics.totalTokens.cacheWrite;

  const recentSessions = sessions.slice(0, 6);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 1280 }}>
      <header>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
          Overview
        </h1>
        <p style={{ fontSize: 13, color: "var(--af-text-secondary)", marginTop: 4 }}>
          Everything happening across your Claude Code projects, read from{" "}
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
      </header>

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
        />
        <MetricCard
          label="Total time"
          value={formatDuration(metrics.totalDurationMs)}
          sub={`avg ${formatDuration(metrics.avgDurationMs)} / session`}
          icon={<Clock size={13} />}
        />
        <MetricCard
          label="Tool calls"
          value={metrics.totalToolCalls.toLocaleString()}
          sub={`avg ${metrics.sessionCount ? Math.round(metrics.totalToolCalls / metrics.sessionCount) : 0} / session`}
          icon={<Zap size={13} />}
        />
        <MetricCard
          label="Input tokens"
          value={formatTokens(totalInput)}
          sub={`${formatTokens(metrics.totalTokens.output)} output`}
          icon={<Activity size={13} />}
        />
        <MetricCard
          label="Avg turns"
          value={metrics.avgTurnsPerSession.toFixed(1)}
          sub="per session"
        />
        <MetricCard
          label="Parallel peaks"
          value={parallelRuns.length > 0 ? String(Math.max(...parallelRuns.map((r) => r.peak))) : "—"}
          sub={`${parallelRuns.length} intervals`}
        />
      </section>

      {/* Heatmap + chart */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
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
            <Link href="/projects" style={{ fontSize: 11, color: "var(--af-accent)" }}>
              View all →
            </Link>
          </div>
          <div>
            {projects.length === 0 ? (
              <div className="af-empty">No projects yet.</div>
            ) : (
              projects.map((p) => (
                <Link
                  key={p.projectDir}
                  href={`/projects/${encodeURIComponent(p.projectDir)}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
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
                    }}
                  >
                    {p.sessions.length} sessions
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--af-text-tertiary)",
                      minWidth: 56,
                      textAlign: "right",
                    }}
                  >
                    {p.lastActiveMs ? formatRelative(new Date(p.lastActiveMs).toISOString()) : "—"}
                  </div>
                </Link>
              ))
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
                key={s.id}
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
                <div>
                  <div
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "var(--af-text)",
                    }}
                  >
                    {s.firstUserPreview || <em style={{ color: "var(--af-text-tertiary)" }}>(no user message)</em>}
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
                >
                  {formatDuration(s.durationMs)}
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

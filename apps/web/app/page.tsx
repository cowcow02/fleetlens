/**
 * Dashboard home — high-level metrics across all Claude Code sessions.
 *
 * Everything here is server-rendered from @claude-lens/parser/fs, then
 * passed down to small interactive client components (heatmap, chart).
 */

import {
  dailyActivity,
  computeBurstsFromSessions,
  summarizeBursts,
  groupByProject,
  highLevelMetrics,
  type SessionMeta,
} from "@claude-lens/parser";
import { Heatmap } from "@/components/heatmap";
import { ActivityChart } from "@/components/activity-chart";
import { MetricCard } from "@/components/metric-card";
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
  const burstStats = summarizeBursts(computeBurstsFromSessions(sessions));
  // Top projects: total tokens desc with session count as tiebreaker.
  const projects = groupByProject(sessions)
    .sort((a, b) => {
      const aTokens =
        a.metrics.totalTokens.input +
        a.metrics.totalTokens.output +
        a.metrics.totalTokens.cacheRead +
        a.metrics.totalTokens.cacheWrite;
      const bTokens =
        b.metrics.totalTokens.input +
        b.metrics.totalTokens.output +
        b.metrics.totalTokens.cacheRead +
        b.metrics.totalTokens.cacheWrite;
      if (bTokens !== aTokens) return bTokens - aTokens;
      return b.metrics.sessionCount - a.metrics.sessionCount;
    })
    .slice(0, 8);

  const totalInput =
    metrics.totalTokens.input + metrics.totalTokens.cacheRead + metrics.totalTokens.cacheWrite;

  // Recent sessions include live ones; the inline LiveBadge on each row
  // shows the LIVE label when the session is currently active, and the
  // floating LiveSessionsWidget handles the cross-page live indicator.
  const recentSessions = sessions.slice(0, 6);

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
          tooltip={`Estimated API spend priced per-model across all sessions.\nInput: ${formatTokens(metrics.totalTokens.input)}\nOutput: ${formatTokens(metrics.totalTokens.output)}\nCache read: ${formatTokens(metrics.totalTokens.cacheRead)}\nCache write: ${formatTokens(metrics.totalTokens.cacheWrite)}`}
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
          label="Parallelism"
          value={
            burstStats.burstCount > 0
              ? formatDuration(burstStats.totalParallelMs)
              : "—"
          }
          sub={
            burstStats.burstCount > 0
              ? `peak ×${burstStats.peakConcurrent} · ${burstStats.burstCount} burst${burstStats.burstCount === 1 ? "" : "s"} · ${burstStats.activeDayCount} day${burstStats.activeDayCount === 1 ? "" : "s"}`
              : "no sustained parallelism"
          }
          tooltip={`Total time where ≥2 agents were actively working in parallel, summed across all detected bursts. Peak concurrency is the highest agent count during any single burst.\n\nBursts are detected by sweep-line over session active segments (same 3-min idle-gap split as airtime), then:\n  • drop overlaps under 1 minute\n  • merge overlaps within 10 minutes of each other\n\nThis filters out accidental tab-switch artifacts and fragments — a morning of back-and-forth agent work becomes one burst, not forty.\n\n${burstStats.burstCount} burst${burstStats.burstCount === 1 ? "" : "s"} across ${burstStats.activeDayCount} day${burstStats.activeDayCount === 1 ? "" : "s"}. ${burstStats.crossProjectBurstCount} of ${burstStats.burstCount} bursts spanned multiple projects.`}
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

      {/* Top projects + Recent sessions */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1.4fr",
          gap: 16,
        }}
      >
        <div className="af-panel">
          <div className="af-panel-header">
            <span>Top projects</span>
            <span style={{ fontSize: 11, color: "var(--af-text-tertiary)", fontWeight: 400 }}>
              by total tokens
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

        <div className="af-panel">
          <div className="af-panel-header">
            <span>Recent sessions</span>
            <Link
              href="/sessions"
              style={{ fontSize: 11, color: "var(--af-accent)", marginLeft: "auto" }}
            >
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
                    gridTemplateColumns: "1fr auto auto",
                    gap: 12,
                    padding: "10px 18px",
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
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {prettyProjectName(s.projectName)}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--af-text-tertiary)",
                      fontFamily: "var(--font-mono)",
                      textAlign: "right",
                      minWidth: 54,
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
                      minWidth: 54,
                    }}
                  >
                    {s.firstTimestamp ? formatRelative(s.firstTimestamp) : "—"}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

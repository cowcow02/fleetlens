import { notFound } from "next/navigation";
import Link from "next/link";
import { listSessions, getSession } from "@/lib/data";
import {
  dailyActivity,
  detectParallelRuns,
  detectPrMarkers,
  highLevelMetrics,
  sessionAirTimeMs,
} from "@claude-lens/parser";
import { Heatmap } from "@/components/heatmap";
import { ActivityChart } from "@/components/activity-chart";
import { MetricCard } from "@/components/metric-card";
import { ParallelRunsStrip } from "@/components/parallel-runs-strip";
import {
  formatDuration,
  formatTokens,
  formatRelative,
  prettyProjectName,
  shortId,
  estimateCostMulti,
  formatCost,
} from "@/lib/format";
import { ArrowLeft, Clock, ListTree, Zap, DollarSign, GitPullRequest } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ProjectDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const decodedDir = decodeURIComponent(slug);
  const all = await listSessions();
  const projectSessions = all.filter((s) => s.projectDir === decodedDir);
  if (projectSessions.length === 0) return notFound();

  const projectName = projectSessions[0]!.projectName;
  const metrics = highLevelMetrics(projectSessions);
  const buckets = dailyActivity(projectSessions);
  const parallelRuns = detectParallelRuns(projectSessions, 2);

  // PR detection is per-session — it needs the event stream, so load the
  // detail for each session and scan. Cap at first 50 sessions so a project
  // with thousands doesn't hang the page; in practice that still captures
  // several months of work.
  const sliced = projectSessions.slice(0, 50);
  const detailResults = await Promise.all(sliced.map((s) => getSession(s.id)));
  const prMarkers = detailResults
    .filter((d): d is NonNullable<typeof d> => !!d)
    .flatMap((d) => detectPrMarkers(d));

  // Air-time (refined) — re-compute across the loaded details for accuracy.
  const refinedAirMs = detailResults
    .filter((d): d is NonNullable<typeof d> => !!d)
    .reduce((a, d) => a + sessionAirTimeMs(d.events), 0);

  const totalTokens =
    metrics.totalTokens.input +
    metrics.totalTokens.output +
    metrics.totalTokens.cacheRead +
    metrics.totalTokens.cacheWrite;

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
      {/* Breadcrumb */}
      <div style={{ fontSize: 12, color: "var(--af-text-tertiary)" }}>
        <Link
          href="/projects"
          style={{
            color: "var(--af-text-tertiary)",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <ArrowLeft size={12} /> Projects
        </Link>
      </div>

      {/* Header */}
      <header>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
          {prettyProjectName(projectName)}
        </h1>
        <p
          style={{
            fontSize: 12,
            color: "var(--af-text-tertiary)",
            marginTop: 4,
            fontFamily: "var(--font-mono)",
          }}
        >
          {projectName}
        </p>
      </header>

      {/* Metric cards */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 12,
        }}
      >
        <MetricCard
          label="Sessions"
          value={metrics.sessionCount.toLocaleString()}
          sub={`${metrics.totalTurns.toLocaleString()} turns`}
          icon={<ListTree size={13} />}
          tooltip="Total Claude Code sessions in this project. A 'turn' is one user message that starts an agent response cycle."
        />
        <MetricCard
          label="Air-time"
          value={formatDuration(refinedAirMs || metrics.totalAirTimeMs)}
          sub={`avg ${formatDuration(metrics.avgDurationMs)}`}
          icon={<Clock size={13} />}
          tooltip="Sum of time the agent was actively working. Gaps longer than 3 minutes (user away, laptop lid closed) are excluded — this is NOT wall-clock duration."
        />
        <MetricCard
          label="Tool calls"
          value={metrics.totalToolCalls.toLocaleString()}
          sub={`avg ${Math.round(metrics.totalToolCalls / Math.max(1, metrics.sessionCount))}`}
          icon={<Zap size={13} />}
          tooltip="Total tool invocations (Bash, Read, Edit, Write, Grep, Glob, Agent, etc.) across all sessions. Higher counts typically mean more complex tasks."
        />
        <MetricCard
          label="Est. cost"
          value={formatCost(estimateCostMulti(projectSessions))}
          sub={`${formatTokens(totalTokens)} in · ${formatTokens(metrics.totalTokens.output)} out`}
          icon={<DollarSign size={13} />}
          tooltip={`Estimated API spend based on each session's primary model.\nUpper bound — mixed-model sessions are priced at the primary model's rate.\nInput: ${formatTokens(metrics.totalTokens.input)}\nOutput: ${formatTokens(metrics.totalTokens.output)}\nCache read: ${formatTokens(metrics.totalTokens.cacheRead)}\nCache write: ${formatTokens(metrics.totalTokens.cacheWrite)}`}
        />
        <MetricCard
          label="PRs shipped"
          value={String(prMarkers.length)}
          sub={prMarkers.length > 0 ? `${sliced.length} sessions scanned` : "scanned recent 50"}
          icon={<GitPullRequest size={13} />}
          tooltip="PRs detected by scanning for `gh pr create` Bash commands in session transcripts. Only the most recent 50 sessions are scanned."
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
          value={
            parallelRuns.length > 0 ? String(Math.max(...parallelRuns.map((r) => r.peak))) : "—"
          }
          sub={`${parallelRuns.length} intervals`}
          tooltip="Maximum number of Claude Code sessions running simultaneously. Detected via sweep-line over session start/end intervals."
        />
      </section>

      {/* Heatmap + Activity chart — side by side */}
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

      {/* PR timeline + Parallel runs — two-column */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: prMarkers.length > 0 && parallelRuns.length > 0 ? "1fr 1fr" : "1fr",
          gap: 16,
        }}
      >
        {prMarkers.length > 0 && (
          <div className="af-panel">
            <div className="af-panel-header">
              <span>Pull requests shipped</span>
              <span
                style={{ fontSize: 11, color: "var(--af-text-tertiary)", fontWeight: 400 }}
              >
                detected from `gh pr create` calls
              </span>
            </div>
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
              {prMarkers
                .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
                .slice(0, 25)
                .map((m, i) => (
                  <Link
                    key={i}
                    href={`/sessions/${m.sessionId}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "100px 1fr 70px",
                      gap: 10,
                      padding: "10px 14px",
                      border: "1px solid var(--af-border-subtle)",
                      borderRadius: 8,
                      background: "var(--af-surface-hover)",
                      fontSize: 12,
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--af-text-secondary)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {formatRelative(m.timestamp)}
                    </div>
                    <div
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: "var(--af-text)",
                      }}
                      title={m.command}
                    >
                      {m.title ?? m.command.replace(/^gh pr create /, "").slice(0, 120)}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--af-text-tertiary)",
                        fontFamily: "var(--font-mono)",
                        textAlign: "right",
                      }}
                    >
                      {m.positionInSession !== undefined
                        ? `${Math.round(m.positionInSession * 100)}% in`
                        : "—"}
                    </div>
                  </Link>
                ))}
            </div>
          </div>
        )}

        {parallelRuns.length > 0 && (
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
        )}
      </section>

      {/* Session list */}
      <div className="af-panel">
        <div className="af-panel-header">
          <span>Sessions</span>
          <span style={{ fontSize: 11, color: "var(--af-text-tertiary)", fontWeight: 400 }}>
            newest first
          </span>
        </div>
        <div>
          {projectSessions.map((s) => (
            <Link
              key={`${s.projectDir}/${s.id}`}
              href={`/sessions/${s.id}`}
              style={{
                display: "grid",
                gridTemplateColumns: "100px 1fr 90px 90px",
                gap: 14,
                padding: "12px 18px",
                fontSize: 12,
                borderBottom: "1px solid var(--af-border-subtle)",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--af-text-tertiary)",
                }}
              >
                sesn_{shortId(s.id)}
              </div>
              <div
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "var(--af-text)",
                }}
              >
                {s.firstUserPreview || (
                  <em style={{ color: "var(--af-text-tertiary)" }}>(no user message)</em>
                )}
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
          ))}
        </div>
      </div>
    </div>
  );
}

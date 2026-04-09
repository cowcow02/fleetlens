import { notFound } from "next/navigation";
import Link from "next/link";
import { listSessions, getSession } from "@/lib/data";
import {
  dailyActivity,
  detectParallelRuns,
  detectPrMarkers,
  highLevelMetrics,
  sessionAirTimeMs,
} from "@claude-sessions/parser";
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
} from "@/lib/format";
import { ArrowLeft, Clock, ListTree, Zap, Activity, GitPullRequest } from "lucide-react";

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
    <div style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 1280 }}>
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
        />
        <MetricCard
          label="Air-time"
          value={formatDuration(refinedAirMs || metrics.totalAirTimeMs)}
          sub={`avg ${formatDuration(metrics.avgDurationMs)}`}
          icon={<Clock size={13} />}
        />
        <MetricCard
          label="Tool calls"
          value={metrics.totalToolCalls.toLocaleString()}
          sub={`avg ${Math.round(metrics.totalToolCalls / Math.max(1, metrics.sessionCount))}`}
          icon={<Zap size={13} />}
        />
        <MetricCard
          label="Tokens"
          value={formatTokens(totalTokens)}
          sub={`${formatTokens(metrics.totalTokens.output)} output`}
          icon={<Activity size={13} />}
        />
        <MetricCard
          label="PRs shipped"
          value={String(prMarkers.length)}
          sub={prMarkers.length > 0 ? `${sliced.length} sessions scanned` : "scanned recent 50"}
          icon={<GitPullRequest size={13} />}
        />
        <MetricCard
          label="Parallel peaks"
          value={
            parallelRuns.length > 0 ? String(Math.max(...parallelRuns.map((r) => r.peak))) : "—"
          }
          sub={`${parallelRuns.length} intervals`}
        />
      </section>

      {/* Heatmap */}
      <div className="af-panel">
        <div className="af-panel-header">
          <span>Daily activity</span>
        </div>
        <div style={{ padding: 18 }}>
          <Heatmap buckets={buckets} valueKey="sessions" />
        </div>
      </div>

      {/* Activity chart */}
      <div className="af-panel">
        <div className="af-panel-header">
          <span>Per-day breakdown</span>
        </div>
        <div style={{ padding: 18 }}>
          <ActivityChart buckets={buckets} />
        </div>
      </div>

      {/* PR timeline */}
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
                    gridTemplateColumns: "140px 1fr 90px",
                    gap: 14,
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

      {/* Parallel runs */}
      {parallelRuns.length > 0 && (
        <div className="af-panel">
          <div className="af-panel-header">
            <span>Parallel runs</span>
          </div>
          <div style={{ padding: 14 }}>
            <ParallelRunsStrip runs={parallelRuns} />
          </div>
        </div>
      )}

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
              key={s.id}
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
          ))}
        </div>
      </div>
    </div>
  );
}

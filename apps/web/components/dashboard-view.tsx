import type { ReactNode } from "react";
import {
  type SessionMeta,
  dailyActivity,
  computeBurstsFromSessions,
  summarizeBursts,
  highLevelMetrics,
} from "@claude-lens/parser";
import { Heatmap } from "@/components/heatmap";
import { ActivityChart } from "@/components/activity-chart";
import { MetricCard } from "@/components/metric-card";
import { formatDuration, formatTokens, formatCost, estimateCostMulti } from "@/lib/format";
import { ListTree, Clock, Zap, DollarSign } from "lucide-react";

/**
 * Shared dashboard body — 6 headline metric cards + heatmap and daily
 * activity chart. Used by:
 *   - The overview home page (all sessions)
 *   - The project detail page (sessions filtered to one project)
 *
 * Any per-session-set dashboard should render through this so the
 * layouts stay aligned automatically. Callers are expected to add
 * their own page header above and supplementary sections below.
 *
 * `override` lets a specific metric card be swapped — used by the
 * project detail page to plug in refined values (e.g. air-time
 * recomputed from full session detail, or a PR-shipped count).
 */
export function DashboardView({
  sessions,
  override,
}: {
  sessions: SessionMeta[];
  override?: {
    activeTimeMs?: number;
    extraCards?: ReactNode;
  };
}) {
  const metrics = highLevelMetrics(sessions);
  const buckets = dailyActivity(sessions);
  const burstStats = summarizeBursts(computeBurstsFromSessions(sessions));

  const totalInput =
    metrics.totalTokens.input + metrics.totalTokens.cacheRead + metrics.totalTokens.cacheWrite;

  const activeTimeMs = override?.activeTimeMs ?? metrics.totalAirTimeMs;
  const activeDayCount = buckets.filter((b) => b.airTimeMs > 0).length;

  return (
    <>
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
          sub={
            <SubLines
              line1={`${metrics.totalTurns.toLocaleString()} turns`}
              line2={`avg ${
                metrics.sessionCount
                  ? Math.round(metrics.totalTurns / metrics.sessionCount)
                  : 0
              } / session`}
            />
          }
          icon={<ListTree size={13} />}
          tooltip="Total Claude Code sessions (one JSONL file = one session). A 'turn' is one user message that starts an agent response cycle."
        />
        <MetricCard
          label="Active time"
          value={formatDuration(activeTimeMs)}
          sub={
            activeDayCount > 0 ? (
              <SubLines
                line1={`${formatDuration(activeTimeMs / activeDayCount)} / day`}
                line2={`${activeDayCount} active days`}
              />
            ) : (
              "no activity"
            )
          }
          icon={<Clock size={13} />}
          tooltip="Sum of time the agent was actively working across all sessions. Gaps longer than 3 minutes (user away, laptop lid closed) are excluded. This is NOT wall-clock duration. Per-day average is across days with any activity."
        />
        <MetricCard
          label="Tool calls"
          value={metrics.totalToolCalls.toLocaleString()}
          sub={
            <SubLines
              line1={`avg ${
                metrics.sessionCount
                  ? Math.round(metrics.totalToolCalls / metrics.sessionCount)
                  : 0
              } / session`}
              line2={`across ${metrics.sessionCount.toLocaleString()} sessions`}
            />
          }
          icon={<Zap size={13} />}
          tooltip="Total tool invocations (Bash, Read, Edit, Write, Grep, Glob, Agent, etc.) across all sessions."
        />
        <MetricCard
          label="Parallelism"
          value={burstStats.burstCount > 0 ? formatDuration(burstStats.totalParallelMs) : "—"}
          sub={
            burstStats.burstCount > 0 ? (
              <SubLines
                line1={`peak ×${burstStats.peakConcurrent}`}
                line2={`${Math.round(
                  (burstStats.totalParallelMs / Math.max(1, activeTimeMs)) * 100,
                )}% of active time`}
              />
            ) : (
              "no sustained parallelism"
            )
          }
          tooltip={`Total time ≥2 agents were working in parallel, with peak concurrency as the highest count in any single burst.\n\n${burstStats.burstCount} burst${burstStats.burstCount === 1 ? "" : "s"} · ${burstStats.crossProjectBurstCount} spanned multiple projects.`}
        />
        <MetricCard
          label="Code changes"
          value={
            <span>
              <span style={{ color: "var(--af-success)" }}>
                +{compactInt(metrics.totalLinesAdded)}
              </span>{" "}
              <span style={{ color: "var(--af-danger)" }}>
                -{compactInt(metrics.totalLinesRemoved)}
              </span>
            </span>
          }
          sub={
            <SubLines
              line1={`${metrics.totalFilesEdited.toLocaleString()} files touched`}
              line2={`${compactInt(
                metrics.totalLinesAdded + metrics.totalLinesRemoved,
              )} total lines`}
            />
          }
          tooltip={`Total lines added and removed across all Edit + Write tool calls.\n+${metrics.totalLinesAdded.toLocaleString()} added\n-${metrics.totalLinesRemoved.toLocaleString()} removed\n${metrics.totalFilesEdited.toLocaleString()} unique files touched`}
        />
        <MetricCard
          label="Est. cost"
          value={formatCost(estimateCostMulti(sessions))}
          sub={
            <SubLines
              line1={`${compactTokens(totalInput)} in`}
              line2={`${compactTokens(metrics.totalTokens.output)} out`}
            />
          }
          icon={<DollarSign size={13} />}
          tooltip={`Estimated API spend priced per-model across all sessions.\nInput: ${formatTokens(metrics.totalTokens.input)}\nOutput: ${formatTokens(metrics.totalTokens.output)}\nCache read: ${formatTokens(metrics.totalTokens.cacheRead)}\nCache write: ${formatTokens(metrics.totalTokens.cacheWrite)}`}
        />
        {override?.extraCards}
      </section>

      {/* Heatmap + Daily activity — side by side */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 2fr",
          gap: 16,
        }}
      >
        <div className="af-panel" style={{ display: "flex", flexDirection: "column" }}>
          <div className="af-panel-header">
            <span>Contribution heatmap</span>
            <span style={{ fontSize: 11, color: "var(--af-text-tertiary)", fontWeight: 400 }}>
              sessions / day
            </span>
          </div>
          <div
            style={{
              padding: 18,
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
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
    </>
  );
}

/** Two-line sub for MetricCard. */
function SubLines({ line1, line2 }: { line1: string; line2: string }) {
  return (
    <div style={{ lineHeight: 1.4 }}>
      <div>{line1}</div>
      <div style={{ color: "var(--af-text-tertiary)" }}>{line2}</div>
    </div>
  );
}

/** Compact integer: 1.2k, 242.7k, 1.3M */
function compactInt(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1) + "k";
  return (n / 1_000_000).toFixed(1) + "M";
}

/** Compact tokens up to billions: 8.5M, 1.2B, 7.8B */
function compactTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1) + "k";
  if (n < 1_000_000_000) return (n / 1_000_000).toFixed(1) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

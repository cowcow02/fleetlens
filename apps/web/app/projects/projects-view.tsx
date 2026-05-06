"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProjectRollup } from "@claude-lens/parser";
import type { DayOutcome } from "@claude-lens/entries";
import { formatDuration, formatRelative, formatTokens, prettyProjectName } from "@/lib/format";
import { DataTable, type Column } from "@/components/data-table";
import { useViewToggle } from "@/components/view-toggle";
import { OutcomeMixRow } from "@/components/outcome-mix-row";
import { AgentMixChip } from "@/components/agent-mix-chip";

export type ProjectRow = {
  project: ProjectRollup;
  recentDays: Array<{ date: string; outcome: DayOutcome | null }>;
};

export function ProjectsView({ rows }: { rows: ProjectRow[] }) {
  const router = useRouter();
  const { mode, toggle } = useViewToggle("cclens:projects:view");

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        {toggle}
      </div>
      {mode === "table" ? (
        <DataTable<ProjectRow>
          rows={rows}
          getRowKey={(r) => r.project.projectDir}
          onRowClick={(r) =>
            router.push(`/projects/${encodeURIComponent(r.project.projectDir)}`)
          }
          defaultSortKey="lastActive"
          defaultSortDir="desc"
          columns={projectTableColumns}
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 14,
          }}
        >
          {rows.map((r) => (
            <ProjectCard key={r.project.projectDir} row={r} />
          ))}
        </div>
      )}
    </>
  );
}

const projectTableColumns: Column<ProjectRow>[] = [
  {
    key: "name",
    header: "Project",
    sortValue: (r) => r.project.projectName,
    render: (r) => (
      <div>
        <div
          style={{ fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          {prettyProjectName(r.project.projectName)}
          {r.project.worktreeCount > 0 && <WorktreeBadge count={r.project.worktreeCount} />}
          <AgentMixChip perAgent={r.project.perAgent} />
        </div>
        <div
          style={{
            fontSize: 10,
            color: "var(--af-text-tertiary)",
            fontFamily: "var(--font-mono)",
            maxWidth: 320,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={r.project.projectName}
        >
          {r.project.projectName}
        </div>
      </div>
    ),
  },
  {
    key: "recent",
    header: "Recent (7d)",
    sortable: false,
    render: (r) => <OutcomeMixRow days={r.recentDays} />,
  },
  {
    key: "sessions",
    header: "Sessions",
    sortValue: (r) => r.project.metrics.sessionCount,
    align: "right",
    render: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
        {r.project.metrics.sessionCount.toLocaleString()}
      </span>
    ),
  },
  {
    key: "turns",
    header: "Turns",
    sortValue: (r) => r.project.metrics.totalTurns,
    align: "right",
    render: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
        {r.project.metrics.totalTurns.toLocaleString()}
      </span>
    ),
  },
  {
    key: "tools",
    header: "Tool calls",
    sortValue: (r) => r.project.metrics.totalToolCalls,
    align: "right",
    render: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
        {r.project.metrics.totalToolCalls.toLocaleString()}
      </span>
    ),
  },
  {
    key: "airtime",
    header: "Agent time",
    sortValue: (r) => r.project.metrics.totalAirTimeMs,
    align: "right",
    render: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
        {formatDuration(r.project.metrics.totalAirTimeMs)}
      </span>
    ),
  },
  {
    key: "tokens",
    header: "Tokens",
    sortValue: (r) =>
      r.project.metrics.totalTokens.input +
      r.project.metrics.totalTokens.output +
      r.project.metrics.totalTokens.cacheRead +
      r.project.metrics.totalTokens.cacheWrite,
    align: "right",
    render: (r) => {
      const total =
        r.project.metrics.totalTokens.input +
        r.project.metrics.totalTokens.output +
        r.project.metrics.totalTokens.cacheRead +
        r.project.metrics.totalTokens.cacheWrite;
      return (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
          {formatTokens(total)}
        </span>
      );
    },
  },
  {
    key: "lastActive",
    header: "Last active",
    sortValue: (r) => r.project.lastActiveMs ?? 0,
    align: "right",
    render: (r) => (
      <span suppressHydrationWarning style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
        {r.project.lastActiveMs
          ? formatRelative(new Date(r.project.lastActiveMs).toISOString())
          : "—"}
      </span>
    ),
  },
];

function ProjectCard({ row }: { row: ProjectRow }) {
  const p = row.project;
  const totalTokens =
    p.metrics.totalTokens.input +
    p.metrics.totalTokens.output +
    p.metrics.totalTokens.cacheRead +
    p.metrics.totalTokens.cacheWrite;
  const hasOutcomes = row.recentDays.some((d) => d.outcome !== null);
  return (
    <Link
      href={`/projects/${encodeURIComponent(p.projectDir)}`}
      className="af-card"
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "var(--af-text)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {prettyProjectName(p.projectName)}
        </span>
        {p.worktreeCount > 0 && <WorktreeBadge count={p.worktreeCount} />}
        <AgentMixChip perAgent={p.perAgent} />
      </div>
      <div
        style={{ fontSize: 11, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)" }}
      >
        {p.projectName}
      </div>

      {hasOutcomes && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 10,
            color: "var(--af-text-tertiary)",
          }}
        >
          <span>recent:</span>
          <OutcomeMixRow days={row.recentDays} />
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 6,
          marginTop: 6,
          fontSize: 11,
          color: "var(--af-text-secondary)",
        }}
      >
        <Stat label="Sessions" value={String(p.metrics.sessionCount)} />
        <Stat label="Turns" value={String(p.metrics.totalTurns)} />
        <Stat label="Tools" value={String(p.metrics.totalToolCalls)} />
        <Stat label="Agent time" value={formatDuration(p.metrics.totalAirTimeMs)} />
        <Stat label="Tokens" value={formatTokens(totalTokens)} />
        <Stat
          label="Last"
          value={
            p.lastActiveMs ? formatRelative(new Date(p.lastActiveMs).toISOString()) : "—"
          }
        />
      </div>
    </Link>
  );
}

function WorktreeBadge({ count }: { count: number }) {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        padding: "2px 7px",
        borderRadius: 100,
        background: "rgba(167, 139, 250, 0.15)",
        color: "rgba(167, 139, 250, 1)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        flexShrink: 0,
      }}
      title={`${count} git worktree${count === 1 ? "" : "s"} rolled up into this project`}
    >
      +{count} wt
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          color: "var(--af-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{ fontFamily: "var(--font-mono)", marginTop: 2 }}
        suppressHydrationWarning
      >
        {value}
      </div>
    </div>
  );
}

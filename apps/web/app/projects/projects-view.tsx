"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ProjectRollup } from "@claude-lens/parser";
import { formatDuration, formatRelative, formatTokens, prettyProjectName } from "@/lib/format";
import { DataTable, type Column } from "@/components/data-table";
import { useViewToggle } from "@/components/view-toggle";

export function ProjectsView({ projects }: { projects: ProjectRollup[] }) {
  const router = useRouter();
  const { mode, toggle } = useViewToggle("cclens:projects:view");

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 14,
        }}
      >
        {toggle}
      </div>
      {mode === "table" ? (
        <DataTable<ProjectRollup>
          rows={projects}
          getRowKey={(p) => p.projectDir}
          onRowClick={(p) =>
            router.push(`/projects/${encodeURIComponent(p.projectDir)}`)
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
          {projects.map((p) => (
            <ProjectCard key={p.projectDir} project={p} />
          ))}
        </div>
      )}
    </>
  );
}

const projectTableColumns: Column<ProjectRollup>[] = [
  {
    key: "name",
    header: "Project",
    sortValue: (p) => p.projectName,
    render: (p) => (
      <div>
        <div
          style={{
            fontWeight: 500,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {prettyProjectName(p.projectName)}
          {p.worktreeCount > 0 && <WorktreeBadge count={p.worktreeCount} />}
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
          title={p.projectName}
        >
          {p.projectName}
        </div>
      </div>
    ),
  },
  {
    key: "sessions",
    header: "Sessions",
    sortValue: (p) => p.metrics.sessionCount,
    align: "right",
    render: (p) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
        {p.metrics.sessionCount.toLocaleString()}
      </span>
    ),
  },
  {
    key: "turns",
    header: "Turns",
    sortValue: (p) => p.metrics.totalTurns,
    align: "right",
    render: (p) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
        {p.metrics.totalTurns.toLocaleString()}
      </span>
    ),
  },
  {
    key: "tools",
    header: "Tool calls",
    sortValue: (p) => p.metrics.totalToolCalls,
    align: "right",
    render: (p) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
        {p.metrics.totalToolCalls.toLocaleString()}
      </span>
    ),
  },
  {
    key: "airtime",
    header: "Agent time",
    sortValue: (p) => p.metrics.totalAirTimeMs,
    align: "right",
    render: (p) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
        {formatDuration(p.metrics.totalAirTimeMs)}
      </span>
    ),
  },
  {
    key: "tokens",
    header: "Tokens",
    sortValue: (p) =>
      p.metrics.totalTokens.input +
      p.metrics.totalTokens.output +
      p.metrics.totalTokens.cacheRead +
      p.metrics.totalTokens.cacheWrite,
    align: "right",
    render: (p) => {
      const total =
        p.metrics.totalTokens.input +
        p.metrics.totalTokens.output +
        p.metrics.totalTokens.cacheRead +
        p.metrics.totalTokens.cacheWrite;
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
    sortValue: (p) => p.lastActiveMs ?? 0,
    align: "right",
    render: (p) => (
      <span
        suppressHydrationWarning
        style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}
      >
        {p.lastActiveMs ? formatRelative(new Date(p.lastActiveMs).toISOString()) : "—"}
      </span>
    ),
  },
];

function ProjectCard({ project: p }: { project: ProjectRollup }) {
  const totalTokens =
    p.metrics.totalTokens.input +
    p.metrics.totalTokens.output +
    p.metrics.totalTokens.cacheRead +
    p.metrics.totalTokens.cacheWrite;
  return (
    <Link
      href={`/projects/${encodeURIComponent(p.projectDir)}`}
      className="af-card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
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
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {p.projectName}
      </div>
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

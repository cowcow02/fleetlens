import { listSessions } from "@/lib/data";
import { groupByProject } from "@claude-sessions/parser";
import { formatDuration, formatRelative, formatTokens, prettyProjectName } from "@/lib/format";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const sessions = await listSessions();
  const projects = groupByProject(sessions);

  return (
    <div style={{ maxWidth: 1280 }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
          Projects
        </h1>
        <p style={{ fontSize: 13, color: "var(--af-text-secondary)", marginTop: 4 }}>
          {projects.length} project{projects.length === 1 ? "" : "s"} across{" "}
          {sessions.length} session{sessions.length === 1 ? "" : "s"}.
        </p>
      </header>

      {projects.length === 0 ? (
        <div className="af-empty">No projects found.</div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 14,
          }}
        >
          {projects.map((p) => {
            const totalTokens =
              p.metrics.totalTokens.input +
              p.metrics.totalTokens.output +
              p.metrics.totalTokens.cacheRead +
              p.metrics.totalTokens.cacheWrite;
            return (
              <Link
                key={p.projectDir}
                href={`/projects/${encodeURIComponent(p.projectDir)}`}
                className="af-card"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--af-text)" }}>
                  {prettyProjectName(p.projectName)}
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
                  <Stat label="Air-time" value={formatDuration(p.metrics.totalAirTimeMs)} />
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
          })}
        </div>
      )}
    </div>
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
      <div style={{ fontFamily: "var(--font-mono)", marginTop: 2 }}>{value}</div>
    </div>
  );
}

import { notFound } from "next/navigation";
import Link from "next/link";
import { listSessions, getSession } from "@/lib/data";
import {
  canonicalProjectName,
  detectPrMarkers,
  sessionAirTimeMs,
} from "@claude-lens/parser";
import { DashboardView } from "@/components/dashboard-view";
import { LiveBadge } from "@/components/live-badge";
import { TeamBadge } from "@/components/team-badge";
import { formatDuration, formatRelative, prettyProjectName } from "@/lib/format";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ProjectDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Slugs are URL-encoded canonical project names (e.g.
  // `%2FUsers%2Ffoo%2FRepo%2Fbar`). Match any session whose own
  // canonicalProjectName resolves to the same path — that includes the
  // parent repo AND any `/.worktrees/<name>` subdirs, so a project detail
  // page naturally shows all parallel worktree activity in one view.
  const decodedCanonical = decodeURIComponent(slug);
  const all = await listSessions();
  const projectSessions = all.filter(
    (s) => canonicalProjectName(s.projectName) === decodedCanonical,
  );
  if (projectSessions.length === 0) return notFound();

  // Use the canonical name for display (no `.worktrees/<name>` suffix).
  const projectName = decodedCanonical;

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

  const recentSessions = projectSessions.slice(0, 12);
  const hasPrs = prMarkers.length > 0;

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

      <DashboardView
        sessions={projectSessions}
        override={{ activeTimeMs: refinedAirMs || undefined }}
      />

      {/* Pull requests shipped + Recent sessions — two columns (or one if no PRs) */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: hasPrs ? "1fr 1fr" : "1fr",
          gap: 16,
        }}
      >
        {hasPrs && (
          <div className="af-panel">
            <div className="af-panel-header">
              <span>Pull requests shipped</span>
              <span style={{ fontSize: 11, color: "var(--af-text-tertiary)", fontWeight: 400 }}>
                detected from `gh pr create` calls
              </span>
            </div>
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
              {prMarkers
                .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
                .slice(0, 12)
                .map((m, i) => (
                  <Link
                    key={i}
                    href={`/sessions/${m.sessionId}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "90px 1fr 60px",
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
                      suppressHydrationWarning
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
            {recentSessions.map((s) => (
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
                    <TeamBadge session={s} linkable={false} />
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
                  title="Agent time (filters out idle gaps)"
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
                  suppressHydrationWarning
                >
                  {s.firstTimestamp ? formatRelative(s.firstTimestamp) : "—"}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

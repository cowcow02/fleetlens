import { notFound } from "next/navigation";
import Link from "next/link";
import { listSessions, getSession } from "@/lib/data";
import {
  projectRepoName,
  detectPrMarkers,
  sessionAirTimeMs,
} from "@claude-lens/parser";
import type { DayOutcome, DayHelpfulness } from "@claude-lens/entries";
import { DashboardView } from "@/components/dashboard-view";
import { LiveBadge } from "@/components/live-badge";
import { TeamBadge } from "@/components/team-badge";
import { OutcomePill, OUTCOME_STYLES } from "@/components/outcome-pill";
import { HelpfulnessSparkline } from "@/components/helpfulness-sparkline";
import { buildEntriesIndex, listCachedDayDigests } from "@/lib/entries-index";
import { formatDuration, formatRelative, prettyProjectName } from "@/lib/format";
import { ArrowLeft } from "lucide-react";

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

const OUTCOME_PRI: Record<DayOutcome, number> = {
  shipped: 6, partial: 5, blocked: 4, exploratory: 3, trivial: 2, idle: 1,
};

export const dynamic = "force-dynamic";

export default async function ProjectDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Slugs are URL-encoded canonical project names (e.g.
  // Slugs are repo names (e.g. `claude-lens`). Match any session in that repo,
  // which folds the parent repo, every `/.worktrees/<name>` subdir, and the
  // same repo reached via Conductor / Superset into one view.
  const decodedCanonical = decodeURIComponent(slug);
  const all = await listSessions();
  const projectSessions = all.filter(
    (s) => projectRepoName(s.projectName) === decodedCanonical,
  );
  if (projectSessions.length === 0) return notFound();

  // Display the repo name.
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

  // Build the recent-7-days strip + helpfulness sparkline.
  const days = lastNDays(7);
  const [entriesIndex, cachedDigests] = await Promise.all([
    buildEntriesIndex(),
    listCachedDayDigests(),
  ]);
  const projectEntries = entriesIndex.byProject.get(decodedCanonical) ?? [];
  const entriesByDay = new Map<string, typeof projectEntries>();
  for (const e of projectEntries) {
    const arr = entriesByDay.get(e.local_day);
    if (arr) arr.push(e); else entriesByDay.set(e.local_day, [e]);
  }
  const recentDays: Array<{
    date: string;
    outcome: DayOutcome | null;
    activeMin: number;
    prCount: number;
  }> = days.map((d) => {
    const list = entriesByDay.get(d) ?? [];
    let best: DayOutcome | null = null;
    let bestPri = 0;
    for (const e of list) {
      const o = e.enrichment.outcome as DayOutcome | null;
      if (!o) continue;
      if ((OUTCOME_PRI[o] ?? 0) > bestPri) {
        bestPri = OUTCOME_PRI[o] ?? 0;
        best = o;
      }
    }
    const activeMin = list.reduce((a, e) => a + (e.numbers.active_min ?? 0), 0);
    const prCount = list.reduce((a, e) => a + e.pr_titles.length, 0);
    return { date: d, outcome: best, activeMin, prCount };
  });
  const helpfulnessDays: Array<{ date: string; helpfulness: DayHelpfulness; cached: boolean }> =
    days.map((d) => {
      const dig = cachedDigests.get(d);
      return {
        date: d,
        helpfulness: dig?.helpfulness_day ?? null,
        cached: !!dig,
      };
    });
  const hasAnyOutcome = recentDays.some((d) => d.outcome !== null);

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

      {hasAnyOutcome && (
        <section className="af-panel">
          <div className="af-panel-header">
            <span>Recent days</span>
            <span style={{ fontSize: 11, color: "var(--af-text-tertiary)", fontWeight: 400 }}>
              last 7 local days
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 8,
              padding: 14,
            }}
          >
            {recentDays.map((d) => {
              const dt = new Date(`${d.date}T12:00:00`);
              const dow = dt.toLocaleDateString("en-US", { weekday: "short" });
              const md = dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              return (
                <Link
                  key={d.date}
                  href={`/digest/${d.date}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    alignItems: "center",
                    padding: "10px 8px",
                    border: "1px solid var(--af-border-subtle)",
                    borderRadius: 8,
                    background: "var(--af-surface)",
                    textDecoration: "none",
                    color: "var(--af-text)",
                    fontSize: 11,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{dow}</span>
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--af-text-tertiary)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {md}
                  </span>
                  {d.outcome ? (
                    <span style={{ fontSize: 16, lineHeight: 1 }} aria-hidden>
                      {OUTCOME_STYLES[d.outcome]?.icon ?? ""}
                    </span>
                  ) : (
                    <span style={{ fontSize: 14, color: "var(--af-text-tertiary)" }}>—</span>
                  )}
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "var(--af-text-secondary)",
                    }}
                  >
                    {d.activeMin > 0 ? `${Math.round(d.activeMin)}m` : "—"}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      color: "var(--af-text-tertiary)",
                    }}
                  >
                    {d.prCount > 0 ? `${d.prCount} PR` : "—"}
                  </span>
                </Link>
              );
            })}
          </div>
          <div
            style={{
              padding: "12px 16px",
              borderTop: "1px solid var(--af-border-subtle)",
            }}
          >
            <HelpfulnessSparkline days={helpfulnessDays} />
          </div>
        </section>
      )}

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

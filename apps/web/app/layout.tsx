import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Sidebar } from "@/components/sidebar";
import { LiveRefresher } from "@/components/live-refresher";
import {
  LiveSessionsWidget,
  type LiveSessionPick,
  type LiveEntrySummary,
} from "@/components/live-sessions-widget";
import { JobQueueWidget } from "@/components/job-queue-widget";
import { listProjects, walkJsonlFiles } from "@claude-lens/parser/fs";
import { listSessions } from "@/lib/data";
import { latestUsageSnapshot } from "@/lib/usage-data";
import { buildEntriesIndex } from "@/lib/entries-index";
import pkg from "../package.json" with { type: "json" };
import "./globals.css";

export const metadata: Metadata = {
  title: "Fleetlens",
  description: "Multi-agent fleet analytics — local-only dashboard for Claude Code, Codex, and other coding-agent sessions.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [projects, allFiles, allSessions, entriesIndex] = await Promise.all([
    listProjects(),
    walkJsonlFiles(),
    // Pull from every registered agent source. The widget filters to the
    // 45s live window client-side, so the slice is on freshness, not count.
    listSessions(),
    buildEntriesIndex(),
  ]);
  const recentSessions = allSessions.slice(0, 20);
  const totalSessions = allSessions.length;
  const currentUsage = latestUsageSnapshot();

  // Project to the minimal shape the widget needs so we don't ship
  // megabytes of SessionMeta (especially activeSegments) to the client.
  const liveSessionPicks: LiveSessionPick[] = recentSessions.map((s) => ({
    id: s.id,
    projectName: s.projectName,
    firstUserPreview: s.firstUserPreview,
    lastUserPreview: s.lastUserPreview,
    lastAgentPreview: s.lastAgentPreview,
    firstTimestamp: s.firstTimestamp,
    lastTimestamp: s.lastTimestamp,
    teamName: s.teamName,
    agentName: s.agentName,
    agent: s.agent,
  }));

  const liveEntrySummaries: Record<string, LiveEntrySummary> = {};
  for (const s of recentSessions) {
    const list = entriesIndex.bySession.get(s.id) ?? [];
    if (list.length === 0) continue;
    const latest = list[list.length - 1]!;
    liveEntrySummaries[s.id] = {
      outcome: latest.enrichment.outcome ?? null,
      enrichmentStatus: latest.enrichment.status,
      localDay: latest.local_day,
    };
  }

  // Read the theme cookie set by the client-side ThemeToggle.
  // After the first visit the cookie is always present, so the server
  // renders with the correct data-theme attribute — no FOUC, no inline
  // <script> tags, no Next 16 warnings.
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("claude-lens-theme")?.value;
  const theme = themeCookie === "light" || themeCookie === "dark" ? themeCookie : "dark";

  return (
    <html lang="en" data-theme={theme} suppressHydrationWarning>
      <body>
        <LiveRefresher />
        <div
          style={{
            display: "flex",
            height: "100vh",
          }}
        >
          <Sidebar
            projects={projects}
            totalSessions={totalSessions}
            currentUsage={currentUsage}
            version={pkg.version}
          />
          <main
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              padding: 0,
              overflow: "auto",
            }}
          >
            {children}
          </main>
        </div>
        <LiveSessionsWidget sessions={liveSessionPicks} entrySummaries={liveEntrySummaries} />
        <JobQueueWidget />
      </body>
    </html>
  );
}

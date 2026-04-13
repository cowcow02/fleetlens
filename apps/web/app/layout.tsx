import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Sidebar } from "@/components/sidebar";
import { LiveRefresher } from "@/components/live-refresher";
import { LiveSessionsWidget, type LiveSessionPick } from "@/components/live-sessions-widget";
import { listProjects, listSessions, walkJsonlFiles } from "@claude-lens/parser/fs";
import { latestUsageSnapshot } from "@/lib/usage-data";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Lens",
  description: "Local-only dashboard for Claude Code sessions.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [projects, allFiles, recentSessions] = await Promise.all([
    listProjects(),
    walkJsonlFiles(),
    // Only need the newest-mtime slice — the widget filters to the 45s
    // live window client-side.
    listSessions({ limit: 20 }),
  ]);
  const totalSessions = allFiles.length;
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
  }));

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
          <Sidebar projects={projects} totalSessions={totalSessions} currentUsage={currentUsage} />
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
        <LiveSessionsWidget sessions={liveSessionPicks} />
      </body>
    </html>
  );
}

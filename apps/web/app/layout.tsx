import type { Metadata } from "next";
import { Sidebar } from "@/components/sidebar";
import { listSessions } from "@claude-sessions/parser/fs";
import { groupByProject } from "@claude-sessions/parser";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Sessions",
  description: "Local-only dashboard for Claude Code sessions.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Load once and pass to the sidebar so it can render the project list
  // without a client-side roundtrip. Layout re-runs on nav anyway.
  const sessions = await listSessions({ limit: 1000 });
  const projects = groupByProject(sessions).map((p) => ({
    projectDir: p.projectDir,
    projectName: p.projectName,
    sessionCount: p.sessions.length,
    lastActiveMs: p.lastActiveMs,
  }));

  return (
    <html lang="en">
      <body>
        <div style={{ display: "flex", minHeight: "100vh" }}>
          <Sidebar projects={projects} totalSessions={sessions.length} />
          <main
            style={{
              flex: 1,
              minWidth: 0,
              padding: "32px 40px",
              overflow: "auto",
            }}
          >
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}

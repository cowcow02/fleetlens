import type { Metadata } from "next";
import { Sidebar } from "@/components/sidebar";
import { ThemeScript } from "@/components/theme-toggle";
import { listProjects, walkJsonlFiles } from "@claude-sessions/parser/fs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Sessions",
  description: "Local-only dashboard for Claude Code sessions.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Fast-path: listProjects() only does fs.stat — no JSONL parsing —
  // so the layout adds ~50ms instead of ~14s (vs. the old listSessions
  // + groupByProject combo).
  const [projects, allFiles] = await Promise.all([listProjects(), walkJsonlFiles()]);
  const totalSessions = allFiles.length;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Runs before React hydrates so there's no FOUC on page load. */}
        <ThemeScript />
      </head>
      <body>
        <div style={{ display: "flex", minHeight: "100vh" }}>
          <Sidebar projects={projects} totalSessions={totalSessions} />
          <main
            style={{
              flex: 1,
              minWidth: 0,
              padding: 0,
              overflow: "auto",
              // Let the page decide its own padding so pages with a
              // sticky header (session detail) can own `top: 0` without
              // the fragile negative-margin trick.
            }}
          >
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}

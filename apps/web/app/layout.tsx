import type { Metadata } from "next";
import { Sidebar } from "@/components/sidebar";
import { ThemeScript } from "@/components/theme-toggle";
import { LiveRefresher } from "@/components/live-refresher";
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
      <body>
        {/* next/script with beforeInteractive — injects synchronously
            before hydration so there's no flash of the wrong theme. */}
        <ThemeScript />
        {/* Single shared EventSource for the whole app. Triggers a
            debounced router.refresh() on any session file change. */}
        <LiveRefresher />
        <div
          style={{
            display: "flex",
            height: "100vh",
            // `height: 100vh` + `overflow: auto` on <main> below makes
            // <main> the actual scroll container. If we used min-height
            // instead, main would expand to fit content and the window
            // would scroll — which breaks `position: sticky` inside
            // main because the sticky element's containing block would
            // be the whole document, not the viewport.
          }}
        >
          <Sidebar projects={projects} totalSessions={totalSessions} />
          <main
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
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

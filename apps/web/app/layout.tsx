import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Sidebar } from "@/components/sidebar";
import { LiveRefresher } from "@/components/live-refresher";
import { listProjects, walkJsonlFiles } from "@claude-lens/parser/fs";
import { latestUsageSnapshot } from "@/lib/usage-data";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Lens",
  description: "Local-only dashboard for Claude Code sessions.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [projects, allFiles] = await Promise.all([listProjects(), walkJsonlFiles()]);
  const totalSessions = allFiles.length;
  const currentUsage = latestUsageSnapshot();

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
      </body>
    </html>
  );
}

import { listSessions } from "@/lib/data";
import { SessionsGrid } from "./sessions-grid";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const sessions = await listSessions();

  return (
    <div style={{ maxWidth: 1280, padding: "32px 40px" }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
          All sessions
        </h1>
        <p style={{ fontSize: 13, color: "var(--af-text-secondary)", marginTop: 4 }}>
          {sessions.length} session{sessions.length === 1 ? "" : "s"} in{" "}
          <code
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              background: "var(--af-border-subtle)",
              padding: "1px 6px",
              borderRadius: 4,
            }}
          >
            ~/.claude/projects
          </code>
        </p>
      </header>
      <SessionsGrid sessions={sessions} />
    </div>
  );
}

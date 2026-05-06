import { homedir } from "node:os";
import { listSessions } from "@/lib/data";
import { buildEntriesIndex } from "@/lib/entries-index";
import { agentSources } from "@claude-lens/parser/fs";
import { SessionsGrid, type SessionRow } from "./sessions-grid";

export const dynamic = "force-dynamic";

const HOME = homedir();
const codeStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  background: "var(--af-border-subtle)",
  padding: "1px 6px",
  borderRadius: 4,
} as const;

export default async function SessionsPage() {
  const [sessions, index] = await Promise.all([listSessions(), buildEntriesIndex()]);

  const rows: SessionRow[] = sessions.map((s) => {
    const entries = index.bySession.get(s.id) ?? [];
    const enrichedDesc = [...entries]
      .reverse()
      .find((e) => e.enrichment.status === "done");
    const latest = entries[entries.length - 1];
    return {
      session: s,
      outcome: index.sessionOutcome.get(s.id) ?? null,
      briefSummary: enrichedDesc?.enrichment.brief_summary ?? null,
      enrichmentStatus: latest?.enrichment.status ?? null,
      latestLocalDay: latest?.local_day ?? null,
    };
  });

  return (
    <div style={{ maxWidth: 1280, padding: "32px 40px" }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
          All sessions
        </h1>
        <p style={{ fontSize: 13, color: "var(--af-text-secondary)", marginTop: 4 }}>
          {sessions.length} session{sessions.length === 1 ? "" : "s"} across{" "}
          {agentSources.map((source, i) => (
            <span key={source.kind}>
              {i > 0 && " + "}
              <code style={codeStyle}>
                {source.defaultRoot.startsWith(HOME)
                  ? "~" + source.defaultRoot.slice(HOME.length)
                  : source.defaultRoot}
              </code>
            </span>
          ))}
        </p>
      </header>
      <SessionsGrid rows={rows} />
    </div>
  );
}

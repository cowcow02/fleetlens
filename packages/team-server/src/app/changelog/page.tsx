import { loadChangelog, latestVersion, type ChangelogEntry } from "../../lib/changelog";
import { ChangelogMarkRead } from "../../components/changelog-mark-read";

export const metadata = { title: "Changelog · Fleetlens" };

export default function ChangelogPage() {
  const entries = loadChangelog();
  const latest = latestVersion(entries);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 32px" }}>
      <ChangelogMarkRead version={latest} />
      <header style={{ marginBottom: 32, borderBottom: "1px solid var(--rule)", paddingBottom: 16 }}>
        <h1 className="serif" style={{ fontSize: 32, margin: 0 }}>
          Changelog
        </h1>
        <p style={{ color: "var(--mute)", fontSize: 14, marginTop: 6 }}>
          Notable changes to the Fleetlens team-server.
        </p>
      </header>

      {entries.length === 0 ? (
        <p style={{ color: "var(--mute)", fontSize: 14 }}>No releases recorded yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          {entries.map((e) => (
            <EntryCard key={e.version} entry={e} />
          ))}
        </div>
      )}
    </main>
  );
}

function EntryCard({ entry }: { entry: ChangelogEntry }) {
  return (
    <section id={`v${entry.version}`}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
        <h2 className="mono" style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
          v{entry.version}
        </h2>
        {entry.date && (
          <span className="mono" style={{ color: "var(--mute)", fontSize: 12 }}>
            {entry.date}
          </span>
        )}
      </div>
      {entry.sections.length === 0 ? (
        <p style={{ color: "var(--mute)", fontSize: 14 }}>No details recorded.</p>
      ) : (
        entry.sections.map((s) => (
          <div key={s.kind} style={{ marginBottom: 14 }}>
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--mute)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 6,
              }}
            >
              {s.kind}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14.5, lineHeight: 1.55 }}>
              {s.bullets.map((b, i) => (
                <li key={i} style={{ marginBottom: 4 }}>{b}</li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

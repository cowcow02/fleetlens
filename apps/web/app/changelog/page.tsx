import { loadChangelog, latestVersion, type ChangelogEntry } from "@/lib/changelog";
import { ChangelogMarkRead } from "@/components/changelog-mark-read";

export const metadata = { title: "Changelog · Fleetlens" };

export default function ChangelogPage() {
  const entries = loadChangelog();
  const latest = latestVersion(entries);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
      <ChangelogMarkRead version={latest} />
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", margin: 0 }}>
          Changelog
        </h1>
        <p style={{ color: "var(--af-text-secondary)", fontSize: 13, marginTop: 6 }}>
          Notable user-facing changes to the Fleetlens CLI.
        </p>
      </header>

      {entries.length === 0 ? (
        <p style={{ color: "var(--af-text-tertiary)", fontSize: 13 }}>
          No releases recorded yet.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
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
    <section
      id={`v${entry.version}`}
      style={{
        borderTop: "1px solid var(--af-border-subtle)",
        paddingTop: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <h2
          style={{
            fontSize: 15,
            fontWeight: 700,
            margin: 0,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.01em",
          }}
        >
          v{entry.version}
        </h2>
        {entry.date && (
          <span style={{ color: "var(--af-text-tertiary)", fontSize: 12 }}>
            {entry.date}
          </span>
        )}
      </div>
      {entry.sections.length === 0 ? (
        <p style={{ color: "var(--af-text-tertiary)", fontSize: 13 }}>
          No details recorded.
        </p>
      ) : (
        entry.sections.map((s) => (
          <div key={s.kind} style={{ marginBottom: 12 }}>
            <div
              style={{
                fontSize: 11,
                color: "var(--af-text-tertiary)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                fontWeight: 600,
                marginBottom: 5,
              }}
            >
              {s.kind}
            </div>
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                fontSize: 13.5,
                color: "var(--af-text)",
                lineHeight: 1.55,
              }}
            >
              {s.bullets.map((b, i) => (
                <li key={i} style={{ marginBottom: 3 }}>{b}</li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

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
        <div>
          {entries.map((entry, idx) => {
            const prevDate = idx > 0 ? entries[idx - 1].date : null;
            const showDateHeader = entry.date && entry.date !== prevDate;
            return (
              <div key={entry.version}>
                {showDateHeader && (
                  <DateHeader date={entry.date!} firstInList={idx === 0} />
                )}
                <EntryCard
                  entry={entry}
                  isLatest={idx === 0}
                  showTopBorder={idx > 0 && !showDateHeader}
                />
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function DateHeader({ date, firstInList }: { date: string; firstInList: boolean }) {
  const rel = relativeDate(date);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        padding: "4px 0",
        marginTop: firstInList ? 0 : 22,
        marginBottom: 10,
        borderTop: "1px solid var(--af-border-subtle)",
        paddingTop: 18,
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
          fontFamily: "var(--font-mono)",
        }}
      >
        {date}
      </span>
      {rel && (
        <span style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>{rel}</span>
      )}
    </div>
  );
}

function EntryCard({
  entry,
  isLatest,
  showTopBorder,
}: {
  entry: ChangelogEntry;
  isLatest: boolean;
  showTopBorder: boolean;
}) {
  const simple =
    entry.sections.length === 1 && entry.sections[0].bullets.length === 1;

  return (
    <section
      id={`v${entry.version}`}
      style={{
        paddingTop: showTopBorder ? 14 : 0,
        marginTop: showTopBorder ? 14 : 0,
        borderTop: showTopBorder ? "1px dashed var(--af-border-subtle)" : "none",
        marginBottom: 18,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 8,
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
        {simple && <SectionPill kind={entry.sections[0].kind} />}
        {isLatest && <Pill text="latest" tone="muted" />}
      </div>

      {entry.sections.length === 0 ? (
        <p style={{ color: "var(--af-text-tertiary)", fontSize: 13 }}>
          No details recorded.
        </p>
      ) : simple ? (
        <p
          style={{
            margin: 0,
            fontSize: 13.5,
            color: "var(--af-text)",
            lineHeight: 1.55,
          }}
        >
          {renderInline(entry.sections[0].bullets[0])}
        </p>
      ) : (
        entry.sections.map((s) => (
          <div key={s.kind} style={{ marginBottom: 10 }}>
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
                paddingLeft: 22,
                fontSize: 13.5,
                color: "var(--af-text)",
                lineHeight: 1.55,
                listStyleType: "disc",
              }}
            >
              {s.bullets.map((b, i) => (
                <li key={i} style={{ marginBottom: 6 }}>{renderInline(b)}</li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

function SectionPill({ kind }: { kind: string }) {
  const tone = kind.toLowerCase() === "fixed"
    ? { fg: "#c4673b", bg: "rgba(196, 103, 59, 0.12)" }
    : kind.toLowerCase() === "added"
    ? { fg: "#3a8b5e", bg: "rgba(58, 139, 94, 0.12)" }
    : kind.toLowerCase() === "changed"
    ? { fg: "#5b6cc4", bg: "rgba(91, 108, 196, 0.12)" }
    : kind.toLowerCase() === "removed"
    ? { fg: "#a64545", bg: "rgba(166, 69, 69, 0.12)" }
    : { fg: "var(--af-text-tertiary)", bg: "var(--af-surface-hover)" };
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        padding: "2px 7px",
        borderRadius: 99,
        background: tone.bg,
        color: tone.fg,
      }}
    >
      {kind}
    </span>
  );
}

function Pill({ text, tone }: { text: string; tone: "accent" | "muted" }) {
  const palette = tone === "accent"
    ? { fg: "var(--af-accent)", bg: "var(--af-accent-subtle)" }
    : { fg: "var(--af-text-tertiary)", bg: "var(--af-surface-hover)" };
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 500,
        padding: "2px 7px",
        borderRadius: 99,
        background: palette.bg,
        color: palette.fg,
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.02em",
      }}
    >
      {text}
    </span>
  );
}

// Inline-code rendering: split text on `…` pairs and wrap each in <code>.
// Keeps the parser data plain while letting the page show backtick spans
// the way the markdown source intended.
function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("`") && p.endsWith("`") && p.length >= 2) {
      return (
        <code
          key={i}
          style={{
            fontFamily: "var(--font-mono)",
            background: "var(--af-surface-hover)",
            padding: "1px 5px",
            borderRadius: 4,
            fontSize: "0.92em",
          }}
        >
          {p.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

function relativeDate(date: string): string | null {
  const t = Date.parse(`${date}T12:00:00`);
  if (Number.isNaN(t)) return null;
  const diffMs = Date.now() - t;
  const days = Math.round(diffMs / 86_400_000);
  if (days < 0) return null;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return null;
}

import { Fragment } from "react";
import { ENTRIES, LATEST_VERSION, type ChangelogEntry } from "../../lib/changelog";
import { ChangelogMarkRead } from "../../components/changelog-mark-read";

export const metadata = { title: "Changelog · Fleetlens" };

const SECTION_TONES: Record<string, { fg: string; bg: string }> = {
  fixed:   { fg: "var(--accent)",      bg: "var(--accent-soft)" },
  added:   { fg: "var(--positive)",    bg: "rgba(47, 93, 59, 0.12)" },
  changed: { fg: "var(--ink-soft)",    bg: "var(--rule-soft)" },
  removed: { fg: "var(--danger)",      bg: "rgba(122, 27, 27, 0.12)" },
};
const DEFAULT_TONE = { fg: "var(--mute)", bg: "var(--rule-soft)" };

export default function ChangelogPage() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 32px" }}>
      <ChangelogMarkRead version={LATEST_VERSION} />
      <header style={{ marginBottom: 28, borderBottom: "1px solid var(--rule)", paddingBottom: 16 }}>
        <h1 className="serif" style={{ fontSize: 32, margin: 0 }}>
          Changelog
        </h1>
        <p style={{ color: "var(--mute)", fontSize: 14, marginTop: 6 }}>
          Notable changes to the Fleetlens team-server.
        </p>
      </header>

      {ENTRIES.length === 0 ? (
        <p style={{ color: "var(--mute)", fontSize: 14 }}>No releases recorded yet.</p>
      ) : (
        <div>
          {ENTRIES.map((entry, idx) => {
            const prevDate = idx > 0 ? ENTRIES[idx - 1].date : null;
            const showDateHeader = entry.date && entry.date !== prevDate;
            return (
              <Fragment key={entry.version}>
                {showDateHeader && (
                  <DateHeader date={entry.date!} firstInList={idx === 0} />
                )}
                <EntryCard entry={entry} isLatest={idx === 0} />
              </Fragment>
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
      className="mono"
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        marginTop: firstInList ? 0 : 24,
        marginBottom: 12,
        paddingTop: firstInList ? 0 : 14,
        borderTop: firstInList ? "none" : "1px solid var(--rule)",
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: "var(--mute)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
        }}
      >
        {date}
      </span>
      {rel && <span style={{ fontSize: 11, color: "var(--mute-soft)" }}>{rel}</span>}
    </div>
  );
}

function EntryCard({ entry, isLatest }: { entry: ChangelogEntry; isLatest: boolean }) {
  const simple = entry.sections.length === 1 && entry.sections[0].bullets.length === 1;

  return (
    <section id={`v${entry.version}`} style={{ marginBottom: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <h2 className="mono" style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
          v{entry.version}
        </h2>
        {simple && <SectionPill kind={entry.sections[0].kind} />}
        {isLatest && <LatestPill />}
      </div>

      {entry.sections.length === 0 ? (
        <p style={{ color: "var(--mute)", fontSize: 14 }}>No details recorded.</p>
      ) : simple ? (
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55 }}>
          {renderInline(entry.sections[0].bullets[0])}
        </p>
      ) : (
        entry.sections.map((s) => (
          <div key={s.kind} style={{ marginBottom: 12 }}>
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--mute)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 5,
              }}
            >
              {s.kind}
            </div>
            <ul style={{ margin: 0, paddingLeft: 22, fontSize: 14.5, lineHeight: 1.55, listStyleType: "disc" }}>
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
  const tone = SECTION_TONES[kind.toLowerCase()] ?? DEFAULT_TONE;
  return (
    <span
      className="mono"
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

function LatestPill() {
  return (
    <span
      className="mono"
      style={{
        fontSize: 10,
        fontWeight: 500,
        padding: "2px 7px",
        borderRadius: 99,
        background: "var(--rule-soft)",
        color: "var(--mute)",
        letterSpacing: "0.02em",
      }}
    >
      latest
    </span>
  );
}

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("`") && p.endsWith("`") && p.length >= 2) {
      return (
        <code
          key={i}
          className="mono"
          style={{
            background: "var(--rule-soft)",
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
  const days = Math.round((Date.now() - t) / 86_400_000);
  if (days < 0) return null;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return null;
}

"use client";
import { useState } from "react";

// FOLLOW-UP: team-server doesn't yet depend on react-markdown. For now we render
// the changelog body verbatim in a <pre>; consider adding react-markdown when UI
// polish becomes a priority.

export interface MigrationInfo {
  filename: string;
  description: string;
  sql: string;
}

export function UpdateReviewView({
  version,
  changelog,
  migrations,
}: {
  version: string;
  changelog: string;
  migrations: MigrationInfo[];
}) {
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function onApply() {
    setApplying(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/updates/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      const data = (await res.json()) as { revisionId?: string; error?: string };
      if (res.ok && data.revisionId) {
        setResult({ ok: true, message: `Update requested. Revision: ${data.revisionId}` });
      } else {
        setResult({ ok: false, message: data.error ?? `HTTP ${res.status}` });
      }
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message });
    } finally {
      setApplying(false);
    }
  }

  return (
    <div>
      <section style={{ marginBottom: 32 }}>
        <div className="subsection-head">
          <h2>What's new in v{version}</h2>
        </div>
        <pre
          style={{
            marginTop: 12,
            padding: "14px 16px",
            background: "var(--paper)",
            border: "1px solid var(--rule)",
            fontFamily: "\"JetBrains Mono\", monospace",
            fontSize: 12,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            overflowX: "auto",
          }}
        >
          {changelog || "(No release notes.)"}
        </pre>
      </section>

      <section style={{ marginBottom: 32 }}>
        <div className="subsection-head">
          <h2>Database changes</h2>
          <span className="kicker">
            {migrations.length === 0
              ? "no new migrations"
              : `${migrations.length} new migration${migrations.length === 1 ? "" : "s"}`}
          </span>
        </div>
        {migrations.length === 0 ? (
          <p style={{ marginTop: 12 }}>
            All migrations bundled in v{version} are already applied to this database.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, marginTop: 12 }}>
            {migrations.map((m) => (
              <li
                key={m.filename}
                style={{
                  padding: "14px 0",
                  borderBottom: "1px solid var(--rule-soft)",
                }}
              >
                <div style={{ marginBottom: 6 }}>
                  <strong className="mono" style={{ fontSize: 12 }}>{m.filename}</strong>
                  {" — "}
                  <span>{m.description}</span>
                </div>
                <pre
                  style={{
                    marginTop: 8,
                    padding: "10px 12px",
                    background: "var(--bg)",
                    border: "1px solid var(--rule)",
                    fontFamily: "\"JetBrains Mono\", monospace",
                    fontSize: 11,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    overflowX: "auto",
                  }}
                >
                  {m.sql}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginBottom: 32 }}>
        <div className="subsection-head">
          <h2>Safety</h2>
        </div>
        <p style={{ marginTop: 12 }}>
          If the update fails, the previous version keeps serving traffic. You won't lose data.
          Migrations run automatically on the new revision's startup.
        </p>
      </section>

      <section>
        <div className="settings-row" style={{ gap: 16 }}>
          <button className="btn" disabled={applying} onClick={onApply}>
            {applying ? "Applying…" : `Apply v${version}`}
          </button>
          {result && (
            <span
              className="kicker"
              style={{ color: result.ok ? "var(--positive)" : "var(--danger)" }}
            >
              {result.message}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

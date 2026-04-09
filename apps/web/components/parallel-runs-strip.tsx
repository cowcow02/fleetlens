import type { ParallelRun } from "@claude-sessions/parser";
import { formatDuration } from "@/lib/format";

export function ParallelRunsStrip({ runs }: { runs: ParallelRun[] }) {
  if (runs.length === 0) {
    return (
      <div className="af-empty" style={{ padding: 24, fontSize: 12 }}>
        No parallel runs detected yet. Try running two sessions at once.
      </div>
    );
  }

  // Show the 10 most recent
  const recent = [...runs].sort((a, b) => b.startMs - a.startMs).slice(0, 10);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {recent.map((run, i) => {
        const dur = run.endMs - run.startMs;
        return (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto auto",
              gap: 14,
              alignItems: "center",
              padding: "10px 14px",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 8,
              background: "var(--af-surface-hover)",
              fontSize: 12,
            }}
          >
            <div style={{ color: "var(--af-text-secondary)" }}>
              {new Date(run.startMs).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>
            <div
              className="af-tag af-tag-accent"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
              }}
            >
              ×{run.peak} parallel
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--af-text-secondary)",
                fontFamily: "var(--font-mono)",
                minWidth: 64,
                textAlign: "right",
              }}
            >
              {formatDuration(dur)}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "var(--af-text-tertiary)",
                fontFamily: "var(--font-mono)",
              }}
              title={run.sessions.join("\n")}
            >
              {run.sessions.length} sessions
            </div>
          </div>
        );
      })}
    </div>
  );
}

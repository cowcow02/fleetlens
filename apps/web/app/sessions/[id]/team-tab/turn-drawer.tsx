"use client";

import { useEffect } from "react";
import type { PresentationRow } from "@claude-lens/parser";
import type { TeamTurn } from "./adapter";

type Props = {
  turn: TeamTurn | null;
  trackLabel: string;
  onClose: () => void;
};

export function TurnDrawer({ turn, trackLabel, onClose }: Props) {
  useEffect(() => {
    if (!turn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [turn, onClose]);

  if (!turn) return null;
  const summary = turn.megaRow.summary;
  const durationMs = turn.endMs - turn.startMs;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.3)",
          zIndex: 1000,
        }}
      />
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          maxWidth: "90vw",
          background: "var(--af-surface-elevated)",
          borderLeft: "1px solid var(--af-border-subtle)",
          zIndex: 1001,
          display: "flex",
          flexDirection: "column",
          fontSize: 12,
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--af-border-subtle)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: turn.agentColor }}>
              {trackLabel}
            </div>
            <div style={{ fontSize: 10, color: "var(--af-text-tertiary)", marginTop: 2 }}>
              {new Date(turn.startMs).toLocaleTimeString()} —{" "}
              {new Date(turn.endMs).toLocaleTimeString()} · {formatDuration(durationMs)}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--af-border-subtle)",
              color: "var(--af-text-tertiary)",
              padding: "4px 10px",
              fontSize: 11,
              cursor: "pointer",
              borderRadius: 4,
            }}
          >
            Close (Esc)
          </button>
        </div>

        <div
          style={{
            padding: "10px 16px",
            display: "flex",
            gap: 12,
            fontSize: 10,
            color: "var(--af-text-tertiary)",
            borderBottom: "1px solid var(--af-border-subtle)",
          }}
        >
          <span>{summary.agentMessages} assistant msgs</span>
          <span>{summary.toolCalls} tool calls</span>
          {summary.errors > 0 && (
            <span style={{ color: "var(--af-error, #f85149)" }}>{summary.errors} errors</span>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
          {turn.megaRow.rows.map((row, i) => (
            <TurnRow key={i} row={row} />
          ))}
        </div>
      </div>
    </>
  );
}

function TurnRow({ row }: { row: PresentationRow }) {
  const wrap = (kind: string, color: string, text: string) => (
    <div
      style={{
        padding: "8px 10px",
        marginBottom: 6,
        background: "var(--af-surface-hover)",
        borderLeft: `2px solid ${color}`,
        borderRadius: 3,
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: "var(--af-text-tertiary)",
          marginBottom: 3,
          textTransform: "uppercase",
        }}
      >
        {kind}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--af-text)",
          lineHeight: 1.4,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {text}
      </div>
    </div>
  );

  if (row.kind === "user")
    return wrap("human", "#f0b429", row.displayPreview ?? row.event.preview ?? "");
  if (row.kind === "agent") return wrap("agent", "#58a6ff", row.event.preview ?? "");
  if (row.kind === "tool-group") {
    const text = row.toolNames
      .map((t) => `${t.name}${t.count > 1 ? ` ×${t.count}` : ""}`)
      .join(" · ");
    return wrap(`${row.count} tool calls`, "#b58cf0", text);
  }
  if (row.kind === "interrupt")
    return wrap("interrupt", "#f85149", row.event.preview ?? "[interrupted]");
  if (row.kind === "error") return wrap("error", "#f85149", row.message);
  if (row.kind === "model") return wrap("model", "#888", row.event.preview ?? "");
  if (row.kind === "task-notification") return wrap(`task ${row.status}`, "#888", row.summary);
  return null;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3600_000).toFixed(1)}h`;
}

"use client";

import { useEffect, useState } from "react";
import type {
  ContentBlock,
  PresentationRow,
  SessionEvent,
} from "@claude-lens/parser";
import type { TeamTurn } from "./adapter";
import { TurnStepsList } from "../turn-steps";

type Props = {
  turn: TeamTurn | null;
  trackLabel: string;
  trackColor: string;
  onClose: () => void;
};

type View =
  | { page: "steps" }
  | { page: "step"; row: PresentationRow; index: number };

export function TurnDrawer({ turn, trackLabel, trackColor, onClose }: Props) {
  const [view, setView] = useState<View>({ page: "steps" });

  // Reset to steps page when a different turn is opened.
  useEffect(() => {
    setView({ page: "steps" });
  }, [turn?.id]);

  useEffect(() => {
    if (!turn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (view.page === "step") setView({ page: "steps" });
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [turn, onClose, view.page]);

  if (!turn) return null;

  const summary = turn.megaRow.summary;
  const startStr = new Date(turn.startMs).toLocaleString();
  const endStr = new Date(turn.endMs).toLocaleTimeString();
  const durationStr = formatDuration(turn.durationMs);

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
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
          background: "var(--af-surface-elevated)",
          borderLeft: "1px solid var(--af-border-subtle)",
          zIndex: 1001,
          display: "flex",
          flexDirection: "column",
          fontSize: 12,
          color: "var(--af-text)",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--af-border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            flexShrink: 0,
          }}
        >
          {view.page === "step" ? (
            <button
              onClick={() => setView({ page: "steps" })}
              style={{
                background: "transparent",
                border: "1px solid var(--af-border-subtle)",
                color: "var(--af-text-secondary)",
                padding: "4px 10px",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 11,
                fontFamily: "ui-monospace, monospace",
              }}
            >
              ← Back to steps
            </button>
          ) : (
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: trackColor,
                  letterSpacing: "0.08em",
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                {trackLabel}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--af-text-tertiary)",
                  fontFamily: "ui-monospace, monospace",
                  marginTop: 2,
                }}
              >
                {startStr} → {endStr} · {durationStr}
              </div>
            </div>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "1px solid var(--af-border-subtle)",
              color: "var(--af-text-secondary)",
              width: 28,
              height: 28,
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 14,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 16px",
          }}
        >
          {view.page === "steps" ? (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  fontSize: 11,
                  color: "var(--af-text-tertiary)",
                  fontFamily: "ui-monospace, monospace",
                  marginBottom: 10,
                }}
              >
                <span>{summary.agentMessages} msg</span>
                <span>·</span>
                <span>{summary.toolCalls} tools</span>
                {summary.errors > 0 && (
                  <>
                    <span>·</span>
                    <span style={{ color: "#f85149" }}>
                      {summary.errors} err
                    </span>
                  </>
                )}
              </div>
              <TurnStepsList
                rows={turn.megaRow.rows}
                onStepClick={(row, index) =>
                  setView({ page: "step", row, index })
                }
              />
            </>
          ) : (
            <StepDetail row={view.row} color={trackColor} />
          )}
        </div>
      </div>
    </>
  );
}

function StepDetail({ row, color }: { row: PresentationRow; color: string }) {
  if (row.kind === "user") {
    return (
      <DetailCard
        label="HUMAN"
        color={color}
        body={row.displayPreview ?? row.event.preview ?? ""}
      />
    );
  }
  if (row.kind === "agent") {
    const text = blocksText(row.event.blocks) || row.event.preview || "";
    return <DetailCard label="AGENT" color={color} body={text} />;
  }
  if (row.kind === "tool-group") {
    return (
      <div>
        <DetailCard
          label={`${row.count} TOOL CALL${row.count === 1 ? "" : "S"}`}
          color={color}
          body=""
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            marginTop: 8,
          }}
        >
          {row.events.map((ev, i) => (
            <ToolCallCard key={i} event={ev} color={color} />
          ))}
        </div>
      </div>
    );
  }
  if (row.kind === "interrupt") {
    return (
      <DetailCard
        label="INTERRUPT"
        color="#f85149"
        body={row.event.preview ?? "[interrupted]"}
      />
    );
  }
  if (row.kind === "error") {
    return <DetailCard label="ERROR" color="#f85149" body={row.message} />;
  }
  if (row.kind === "model") {
    return (
      <DetailCard
        label="MODEL CHANGE"
        color={color}
        body={row.event.preview ?? ""}
      />
    );
  }
  if (row.kind === "task-notification") {
    return (
      <DetailCard
        label={`TASK ${row.status.toUpperCase()}`}
        color={color}
        body={row.summary}
      />
    );
  }
  return null;
}

function DetailCard({
  label,
  color,
  body,
}: {
  label: string;
  color: string;
  body: string;
}) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: "var(--af-surface-hover)",
        borderLeft: `3px solid ${color}`,
        borderRadius: 4,
        marginBottom: 6,
      }}
    >
      <div
        style={{
          fontSize: 9,
          color,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 4,
          fontFamily: "ui-monospace, monospace",
        }}
      >
        {label}
      </div>
      {body && (
        <div
          style={{
            fontSize: 11,
            color: "var(--af-text)",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {body}
        </div>
      )}
    </div>
  );
}

function ToolCallCard({
  event,
  color,
}: {
  event: SessionEvent;
  color: string;
}) {
  const toolUse = (event.blocks ?? []).find((b) => b.type === "tool_use");
  if (!toolUse) return null;
  const name = (toolUse as { name?: string }).name ?? "?";
  const input = (toolUse as { input?: unknown }).input ?? {};
  let inputStr: string;
  try {
    inputStr = JSON.stringify(input, null, 2);
  } catch {
    inputStr = String(input);
  }
  return (
    <div
      style={{
        padding: "8px 10px",
        background: "var(--af-surface)",
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 3,
        fontSize: 10,
        fontFamily: "ui-monospace, monospace",
      }}
    >
      <div style={{ fontWeight: 600, color, marginBottom: 4 }}>{name}</div>
      <pre
        style={{
          margin: 0,
          color: "var(--af-text-secondary)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 280,
          overflow: "auto",
        }}
      >
        {inputStr}
      </pre>
    </div>
  );
}

function blocksText(blocks: ContentBlock[] | undefined): string {
  if (!blocks) return "";
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts.join("\n\n");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3600_000).toFixed(1)}h`;
}

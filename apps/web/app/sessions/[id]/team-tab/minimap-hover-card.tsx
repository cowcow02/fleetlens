"use client";

import { formatGap } from "@/lib/format";
import type { TeamTrack, TeamTurn } from "./adapter";
import { formatTeammatePreview } from "./format";
import { formatEdge } from "./minimap-shared";

export type HoverState = {
  turn: TeamTurn;
  track: TeamTrack;
  clientX: number;
  clientY: number;
};

export function HoverCard({
  hover,
  multiDay,
}: {
  hover: HoverState;
  multiDay: boolean;
}) {
  const { turn, track } = hover;
  const summary = turn.megaRow.summary;
  const tmMsg =
    turn.userPrompt && "event" in turn.userPrompt
      ? turn.userPrompt.event.teammateMessage
      : undefined;
  const userLabel = tmMsg ? `FROM ${tmMsg.teammateId}` : "HUMAN";
  const userText = tmMsg
    ? formatTeammatePreview(tmMsg)
    : turn.userPrompt && turn.userPrompt.kind === "user"
      ? (turn.userPrompt.displayPreview ?? turn.userPrompt.event.preview ?? "")
      : "";
  const firstAgent = summary.firstAgentPreview ?? "";
  const finalAgent = summary.finalAgentPreview ?? "";
  const showFinal = finalAgent && finalAgent !== firstAgent;
  const tools = summary.toolNames.slice(0, 4);

  // Position card near the cursor, biased above-and-right to avoid covering
  // the bar itself. Clamp to viewport via simple offsets.
  const left = Math.min(window.innerWidth - 360, hover.clientX + 12);
  const top = Math.max(8, hover.clientY - 12);

  return (
    <div
      style={{
        position: "fixed",
        left,
        top,
        width: 340,
        background: "var(--af-surface)",
        border: "1px solid var(--af-border-subtle)",
        borderLeft: `3px solid ${track.color}`,
        borderRadius: 4,
        padding: "8px 10px",
        fontSize: 10,
        lineHeight: 1.4,
        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        zIndex: 100,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 9,
          fontFamily: "ui-monospace, monospace",
          color: track.color,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 4,
        }}
      >
        <span>{track.isLead ? "LEAD" : track.label}</span>
        <span style={{ color: "var(--af-text-tertiary)", fontWeight: 500 }}>
          {formatEdge(turn.startMs, multiDay)} → {formatEdge(turn.endMs, multiDay)} · {formatGap(turn.durationMs)}
        </span>
      </div>
      <div
        style={{
          fontSize: 9,
          color: "var(--af-text-tertiary)",
          marginBottom: 6,
        }}
      >
        {summary.agentMessages} msg · {summary.toolCalls} tools
        {summary.errors > 0 ? ` · ${summary.errors} err` : ""}
      </div>
      {userText && (
        <div style={{ marginBottom: 5 }}>
          <div
            style={{
              fontSize: 8,
              color: tmMsg ? "var(--af-text-tertiary)" : track.color,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: 1,
              fontStyle: tmMsg ? "italic" : undefined,
            }}
          >
            {userLabel}
          </div>
          <div
            style={{
              color: tmMsg ? "var(--af-text-tertiary)" : "var(--af-text)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {userText}
          </div>
        </div>
      )}
      {firstAgent && (
        <div style={{ marginBottom: 5 }}>
          <div
            style={{
              fontSize: 8,
              color: track.color,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: 1,
            }}
          >
            AGENT
          </div>
          <div
            style={{
              color: "var(--af-text)",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {firstAgent}
          </div>
        </div>
      )}
      {tools.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 3,
            flexWrap: "wrap",
            marginBottom: showFinal ? 5 : 0,
          }}
        >
          {tools.map((t) => (
            <span
              key={t.name}
              style={{
                fontSize: 8,
                padding: "1px 5px",
                background: "var(--af-surface-hover)",
                borderRadius: 2,
                color: "var(--af-text-tertiary)",
              }}
            >
              {t.name}
              {t.count > 1 ? ` ×${t.count}` : ""}
            </span>
          ))}
        </div>
      )}
      {showFinal && (
        <div>
          <div
            style={{
              fontSize: 8,
              color: track.color,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: 1,
            }}
          >
            RESULT
          </div>
          <div
            style={{
              color: "var(--af-text)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {finalAgent}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  ContentBlock,
  PresentationRow,
  TurnMegaRow,
  SessionEvent,
} from "@claude-lens/parser";
import type { TeamTurn } from "./adapter";
import { TurnStepsList, MAX_INLINE_STEPS, shortenToolName } from "../turn-steps";
import { ToolUseCard, type ToolUseInput } from "../tool-cards";

type Props = {
  turn: TeamTurn | null;
  trackLabel: string;
  trackColor: string;
  onClose: () => void;
};

type View =
  | { page: "turn" }
  | { page: "step"; row: PresentationRow; index: number };

/** Widened drawer to give the full turn card room to breathe. Reads as
 *  roughly the same layout as the transcript's collapsed-turn row — a
 *  standalone modal-ish card inside a drawer rather than a grid row. */
const DRAWER_WIDTH = 620;

export function TurnDrawer({ turn, trackLabel, trackColor, onClose }: Props) {
  const [view, setView] = useState<View>({ page: "turn" });

  useEffect(() => {
    setView({ page: "turn" });
  }, [turn?.id]);

  useEffect(() => {
    if (!turn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (view.page === "step") setView({ page: "turn" });
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [turn, onClose, view.page]);

  if (!turn) return null;

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
          width: DRAWER_WIDTH,
          maxWidth: "96vw",
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
              onClick={() => setView({ page: "turn" })}
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
              ← Back to turn
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
            padding: "14px 18px",
          }}
        >
          {view.page === "turn" ? (
            <FullTurnCard
              turn={turn.megaRow}
              userRow={turn.userPrompt}
              color={trackColor}
              onStepClick={(row, index) => setView({ page: "step", row, index })}
            />
          ) : (
            <StepDetail row={view.row} color={trackColor} />
          )}
        </div>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- */
/*  FullTurnCard — the HUMAN + AGENT + steps + conclusion layout    */
/*  used inside the team drawer. Visually mirrors the transcript's  */
/*  collapsed-turn row but as a standalone vertical card so it fits  */
/*  the drawer / modal context without the grid columns used by the  */
/*  transcript list.                                                 */
/* ---------------------------------------------------------------- */

function FullTurnCard({
  turn,
  userRow,
  color,
  onStepClick,
}: {
  turn: TurnMegaRow;
  userRow?: PresentationRow;
  color: string;
  onStepClick: (row: PresentationRow, index: number) => void;
}) {
  const s = turn.summary;
  const firstAgentIdx = s.firstAgentIndex ?? -1;
  const finalAgentIdx = s.finalAgentIndex ?? -1;
  const firstAgentRow = firstAgentIdx >= 0 ? turn.rows[firstAgentIdx] : undefined;
  const finalAgentRow =
    finalAgentIdx >= 0 && finalAgentIdx !== firstAgentIdx
      ? turn.rows[finalAgentIdx]
      : undefined;

  // Middle rows exclude the first and conclusion — they're surfaced as
  // their own sections above and below the steps list.
  const middleRows = turn.rows.filter((_, i) => {
    if (i === firstAgentIdx) return false;
    if (finalAgentRow && i === finalAgentIdx) return false;
    return true;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {userRow && userRow.kind === "user" && (() => {
        const tm = userRow.event.teammateMessage;
        const label = tm ? `From ${tm.teammateId}` : "Human";
        // Drawer shows the full body — no truncation. For teammate
        // messages the body is the complete instruction or protocol
        // payload extracted from the <teammate-message> wrapper.
        const text = tm
          ? tm.body
          : (userRow.displayPreview ?? userRow.event.preview ?? "");
        return (
          <ExpandableTextBlock
            label={label}
            color={tm ? "var(--af-text-tertiary)" : color}
            text={text}
          />
        );
      })()}

      {firstAgentRow && firstAgentRow.kind === "agent" && (
        <ExpandableAgentBlock
          label="First message"
          color={color}
          row={firstAgentRow}
        />
      )}

      <TurnStatsRow summary={s} rows={turn.rows} durationMs={turn.durationMs} />

      {middleRows.length > 0 && (
        <StepsSection
          color={color}
          rows={middleRows}
          onStepClick={onStepClick}
        />
      )}

      {finalAgentRow && finalAgentRow.kind === "agent" && (
        <ExpandableAgentBlock
          label="Conclusion"
          color={color}
          row={finalAgentRow}
          arrow
        />
      )}
    </div>
  );
}

function ExpandableTextBlock({
  label,
  color,
  text,
}: {
  label: string;
  color: string;
  text: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      onClick={() => setExpanded((v) => !v)}
      style={{
        padding: "8px 12px",
        borderRadius: 6,
        background: expanded ? "var(--af-surface-hover)" : "transparent",
        border: `1px solid ${expanded ? "var(--af-border-subtle)" : "transparent"}`,
        cursor: "pointer",
        transition: "all 0.12s",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 10,
          color: "var(--af-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 600,
          fontFamily: "ui-monospace, monospace",
        }}
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span style={{ color }}>{label}</span>
      </div>
      {expanded ? (
        <div className="sl-prose" style={{ fontSize: 13, marginTop: 6 }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: (props) => (
                <a
                  {...props}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--af-accent)", textDecoration: "underline" }}
                />
              ),
            }}
          >
            {text}
          </ReactMarkdown>
        </div>
      ) : (
        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            lineHeight: 1.45,
            color: "var(--af-text)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

function StepsSection({
  color,
  rows,
  onStepClick,
}: {
  color: string;
  rows: PresentationRow[];
  onStepClick: (row: PresentationRow, index: number) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const overflow = rows.length - MAX_INLINE_STEPS;
  return (
    <div>
      <SectionLabel color={color}>STEPS</SectionLabel>
      <div style={{ marginTop: 4 }}>
        <TurnStepsList
          rows={rows}
          onStepClick={onStepClick}
          showAll={showAll}
        />
      </div>
      {overflow > 0 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            width: "100%",
            padding: "6px 10px",
            marginTop: 6,
            background: "var(--af-surface-hover)",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 500,
            color: "var(--af-text-secondary)",
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          <ChevronDown size={12} />
          Show all {rows.length} steps
        </button>
      )}
    </div>
  );
}

function ExpandableAgentBlock({
  label,
  color,
  row,
  arrow,
}: {
  label: string;
  color: string;
  row: Extract<PresentationRow, { kind: "agent" }>;
  arrow?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      onClick={() => setExpanded((v) => !v)}
      style={{
        padding: "8px 12px",
        borderRadius: 6,
        background: expanded ? "var(--af-surface-hover)" : "transparent",
        border: `1px solid ${expanded ? "var(--af-border-subtle)" : "transparent"}`,
        cursor: "pointer",
        transition: "all 0.12s",
        borderTop:
          arrow && !expanded ? "1px dashed var(--af-border-subtle)" : undefined,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 10,
          color: "var(--af-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 600,
          fontFamily: "ui-monospace, monospace",
        }}
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span style={{ color }}>{label}</span>
      </div>
      {expanded ? (
        <div
          className="sl-prose"
          style={{
            fontSize: 13,
            marginTop: 6,
            color: "var(--af-text)",
            lineHeight: 1.5,
          }}
        >
          {row.event.blocks
            .filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b, i) => (
              <ReactMarkdown
                key={i}
                remarkPlugins={[remarkGfm]}
                components={{
                  a: (props) => (
                    <a
                      {...props}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "var(--af-accent)",
                        textDecoration: "underline",
                      }}
                    />
                  ),
                }}
              >
                {b.text}
              </ReactMarkdown>
            ))}
        </div>
      ) : (
        <div
          style={{
            marginTop: 4,
            display: "flex",
            gap: 6,
            alignItems: "flex-start",
            fontSize: 13,
            lineHeight: 1.45,
            color: "var(--af-text)",
          }}
        >
          {arrow && (
            <span
              style={{
                color: "var(--af-text-tertiary)",
                marginTop: 1,
                fontSize: 11,
              }}
            >
              →
            </span>
          )}
          <span
            style={{
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
            }}
          >
            {row.event.preview}
          </span>
        </div>
      )}
    </div>
  );
}

function SectionLabel({
  children,
  color,
}: {
  children: React.ReactNode;
  color: string;
}) {
  return (
    <div
      style={{
        fontSize: 9,
        color,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        fontFamily: "ui-monospace, monospace",
      }}
    >
      {children}
    </div>
  );
}

/** Activity summary line — Ghostty-style aggregation of tool use
 *  categories. A slimmer cousin of session-view's TurnStatsLine. */
function TurnStatsRow({
  summary,
  rows,
  durationMs,
}: {
  summary: TurnMegaRow["summary"];
  rows: PresentationRow[];
  durationMs?: number;
}) {
  let editCount = 0;
  let writeCount = 0;
  let readCount = 0;
  let bashCount = 0;
  let searchCount = 0;
  let agentCount = 0;
  let otherToolCount = 0;

  for (const r of rows) {
    if (r.kind !== "tool-group") continue;
    for (const ev of r.events) {
      const name = ev.toolName ?? "";
      switch (name) {
        case "Edit":
          editCount++;
          break;
        case "Write":
          writeCount++;
          break;
        case "Read":
          readCount++;
          break;
        case "Bash":
          bashCount++;
          break;
        case "Grep":
        case "Glob":
          searchCount++;
          break;
        case "Agent":
          agentCount++;
          break;
        default:
          otherToolCount++;
          break;
      }
    }
  }

  const phrases: string[] = [];
  if (editCount + writeCount > 0) {
    const n = editCount + writeCount;
    phrases.push(`Edited ${n} file${n === 1 ? "" : "s"}`);
  }
  if (readCount > 0) phrases.push(`read ${readCount} file${readCount === 1 ? "" : "s"}`);
  if (bashCount > 0) phrases.push(`${bashCount} command${bashCount === 1 ? "" : "s"}`);
  if (searchCount > 0) phrases.push(`${searchCount} search${searchCount === 1 ? "" : "es"}`);
  if (agentCount > 0)
    phrases.push(`${agentCount} sub-agent${agentCount === 1 ? "" : "s"}`);
  if (otherToolCount > 0 && phrases.length === 0)
    phrases.push(`${otherToolCount} tool call${otherToolCount === 1 ? "" : "s"}`);
  if (phrases.length === 0 && summary.agentMessages > 0) {
    phrases.push(
      `${summary.agentMessages} message${summary.agentMessages === 1 ? "" : "s"}`,
    );
  }

  return (
    <div
      style={{
        fontSize: 11,
        color: "var(--af-text-tertiary)",
        lineHeight: 1.5,
        fontFamily: "ui-monospace, monospace",
      }}
    >
      {phrases.join(", ")}
      {summary.errors > 0 && (
        <span style={{ color: "var(--af-danger)" }}>
          {phrases.length > 0 ? ", " : ""}
          {summary.errors} error{summary.errors === 1 ? "" : "s"}
        </span>
      )}
      {durationMs !== undefined && durationMs > 0 && (
        <>
          <span style={{ opacity: 0.5, marginLeft: 6 }}>·</span>
          <span style={{ marginLeft: 6 }}>{formatDuration(durationMs)}</span>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/*  Step detail page — unchanged from the previous drawer iteration */
/* ---------------------------------------------------------------- */

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
    const toolLabel = row.toolNames
      .slice(0, 4)
      .map((t) => {
        const short = shortenToolName(t.name);
        return t.count > 1 ? `${short} ×${t.count}` : short;
      })
      .join(" · ");
    const overflow = row.toolNames.length > 4 ? ` +${row.toolNames.length - 4}` : "";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 0",
            borderBottom: "1px solid var(--af-border-subtle)",
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: 4,
              background: "rgba(138, 133, 128, 0.16)",
              color: "#44403C",
            }}
          >
            Tool
          </span>
          <span
            style={{
              fontSize: 12,
              color: "var(--af-text-secondary)",
              fontWeight: 500,
            }}
          >
            Tool use · {toolLabel}{overflow}
          </span>
        </div>

        {row.events.map((ev, i) => {
          const toolUse = (ev.blocks ?? []).find(
            (b) => b.type === "tool_use",
          ) as { name?: string; input?: ToolUseInput } | undefined;
          if (!toolUse) return null;
          const name = toolUse.name ?? "?";
          const input = toolUse.input ?? {};
          return (
            <div key={i}>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--af-text-tertiary)",
                  fontFamily: "ui-monospace, monospace",
                  marginBottom: 4,
                }}
              >
                #{i + 1}
              </div>
              <ToolUseCard name={name} input={input} />
            </div>
          );
        })}
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
            fontSize: 12,
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

function formatTeammatePreview(
  tm: NonNullable<import("@claude-lens/parser").SessionEvent["teammateMessage"]>,
): string {
  switch (tm.kind) {
    case "idle-notification":
      return `${tm.teammateId} is idle / available`;
    case "shutdown-request":
      return `${tm.teammateId} requesting shutdown`;
    case "shutdown-approved":
      return `${tm.teammateId} shutdown approved`;
    case "teammate-terminated":
      return `${tm.teammateId} has shut down`;
    case "task-assignment":
      return `task assigned to ${tm.teammateId}`;
    default:
      return tm.body.length > 120 ? tm.body.slice(0, 120) + "…" : tm.body;
  }
}

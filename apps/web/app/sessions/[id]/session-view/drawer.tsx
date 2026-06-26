"use client";

/**
 * Drawer + DrawerContent + BlockView — right-side event-inspector panel
 * that opens when a transcript row is clicked. Renders the event's
 * title bar, compact meta line, optional developer panel (model, request
 * id, full usage breakdown), and the event's content blocks via
 * BlockView.
 *
 * DrawerContent dispatches on row.kind so user rows can substitute their
 * raw blocks for a cleaner `displayBlocks` (e.g. slash commands render
 * "/implement AGE-8" instead of the raw XML), task-notification rows
 * get a parsed-fields layout, and multi-call tool-groups list each call
 * individually with offset + tool-use-id headers.
 *
 * BlockView is the leaf renderer: markdown text via ReactMarkdown +
 * remarkGfm, thinking blocks as collapsible details, tool_use as
 * ToolUseCard, tool_result as a pre-formatted code block.
 */
import React, { useState } from "react";
import { X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ContentBlock,
  PresentationRow,
  PresentationRowKind,
  SessionEvent,
} from "@claude-lens/parser";
import { formatGap, formatOffset, formatTokens } from "@/lib/format";
import { ROLE_THEMES, formatToolSummary } from "../turn-steps";
import { ToolUseCard } from "../tool-cards";

export function Drawer({
  event,
  row,
  onClose,
}: {
  event: SessionEvent;
  row: PresentationRow | null;
  onClose: () => void;
}) {
  const [showDev, setShowDev] = useState(false);
  const kind: PresentationRowKind = row?.kind ?? "agent";
  const theme = ROLE_THEMES[kind];
  const title = drawerTitle(row, event);
  const hasUsage = !!event.usage && (event.usage.input > 0 || event.usage.output > 0);

  return (
    <div>
      {/* Sticky title bar */}
      <div
        style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--af-border-subtle)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--af-surface)",
          position: "sticky",
          top: 0,
          zIndex: 1,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 10px",
            borderRadius: 4,
            background: theme.bg,
            color: theme.fg,
          }}
        >
          {theme.label}
        </span>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--af-text)",
          }}
        >
          {title}
        </span>
        <button
          onClick={onClose}
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--af-text-tertiary)",
            padding: 4,
            borderRadius: 4,
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Meta line — compact */}
      <div
        style={{
          padding: "8px 20px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
          borderBottom: "1px solid var(--af-border-subtle)",
        }}
      >
        <span>{formatOffset(event.tOffsetMs)}</span>
        {event.gapMs !== undefined && event.gapMs > 0 && <span>· {formatGap(event.gapMs)}</span>}
        {hasUsage && event.usage && (
          <span style={{ color: "var(--af-text-secondary)" }}>
            · {formatTokens(event.usage.input + event.usage.cacheRead + event.usage.cacheWrite)}/
            {formatTokens(event.usage.output)} tokens
          </span>
        )}
        <button
          onClick={() => setShowDev((s) => !s)}
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: "none",
            fontSize: 10,
            color: "var(--af-text-tertiary)",
            cursor: "pointer",
            padding: 0,
            fontFamily: "inherit",
            textDecoration: "underline",
            textUnderlineOffset: 2,
          }}
        >
          {showDev ? "hide details" : "details"}
        </button>
      </div>

      {/* Developer panel — collapsed by default */}
      {showDev && (
        <div
          style={{
            padding: "10px 20px 14px",
            borderBottom: "1px solid var(--af-border-subtle)",
            fontSize: 11,
            color: "var(--af-text-secondary)",
            fontFamily: "var(--font-mono)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {event.model && <div>model: {event.model}</div>}
          {event.requestId && <div>request: {event.requestId}</div>}
          {event.messageId && <div>message: {event.messageId}</div>}
          {event.stopReason && <div>stop_reason: {event.stopReason}</div>}
          {event.usage && (
            <>
              <div style={{ marginTop: 6, opacity: 0.7 }}>tokens</div>
              <div> input: {event.usage.input.toLocaleString()}</div>
              <div> output: {event.usage.output.toLocaleString()}</div>
              <div> cache read: {event.usage.cacheRead.toLocaleString()}</div>
              <div>
                {"  "}cache write: {event.usage.cacheWrite.toLocaleString()}
              </div>
            </>
          )}
        </div>
      )}

      {/* Content */}
      <div style={{ padding: "18px 22px" }}>
        <DrawerContent event={event} row={row} />
      </div>
    </div>
  );
}

export function drawerTitle(row: PresentationRow | null, event: SessionEvent): string {
  if (row) {
    switch (row.kind) {
      case "user":
        return "Message";
      case "agent":
        return "Message";
      case "tool-group":
        return `Tool use · ${formatToolSummary(row.toolNames)}`;
      case "interrupt":
        return "Interrupted";
      case "model":
        return "Model (zero-usage)";
      case "error":
        return "API error";
      case "task-notification":
        return `Background task · ${row.status}`;
    }
  }
  return event.rawType;
}

export function DrawerContent({
  event,
  row,
}: {
  event: SessionEvent;
  row: PresentationRow | null;
}) {
  // User rows can override their blocks (e.g. slash commands get a cleaned
  // "/implement AGE-8" block instead of the raw XML).
  if (row?.kind === "user" && row.displayBlocks) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {row.displayBlocks.map((b, i) => (
          <BlockView key={i} block={b} />
        ))}
      </div>
    );
  }

  // Task notifications: parsed fields in a clean key-value layout,
  // not the raw <task-notification> XML blob.
  if (row?.kind === "task-notification") {
    const statusColor =
      row.status === "success"
        ? "var(--af-success)"
        : row.status === "failed"
          ? "var(--af-danger)"
          : "var(--af-text-secondary)";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: 4,
              background:
                row.status === "success"
                  ? "var(--af-success-subtle)"
                  : row.status === "failed"
                    ? "var(--af-danger-subtle)"
                    : "var(--af-border-subtle)",
              color: statusColor,
              textTransform: "uppercase",
              letterSpacing: "0.03em",
            }}
          >
            {row.status}
          </span>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--af-text)" }}>{row.summary}</div>
        {(row.taskId || row.toolUseId || row.outputFile) && (
          <div
            style={{
              fontSize: 11,
              color: "var(--af-text-secondary)",
              fontFamily: "var(--font-mono)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              paddingTop: 10,
              borderTop: "1px solid var(--af-border-subtle)",
            }}
          >
            {row.taskId && <div>task id: {row.taskId}</div>}
            {row.toolUseId && <div>tool use: {row.toolUseId.slice(0, 24)}…</div>}
            {row.outputFile && (
              <div style={{ wordBreak: "break-all" }}>output: {row.outputFile}</div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Tool group: list all individual tool calls with their inputs
  if (row?.kind === "tool-group" && row.count > 1) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {row.events.map((e, i) => (
          <div key={e.index}>
            <div
              style={{
                fontSize: 11,
                color: "var(--af-text-tertiary)",
                marginBottom: 4,
                fontFamily: "var(--font-mono)",
              }}
            >
              #{i + 1} · {formatOffset(e.tOffsetMs)} · {e.toolUseId?.slice(0, 14)}…
            </div>
            {e.blocks.map((b, bi) => (
              <BlockView key={bi} block={b} />
            ))}
          </div>
        ))}
      </div>
    );
  }

  // Agent row: include thinking blocks from the same message.id if present
  if (row?.kind === "agent" && row.groupedEvents.length > 1) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {row.groupedEvents.flatMap((e, i) =>
          e.blocks.map((b, bi) => <BlockView key={`${i}-${bi}`} block={b} />),
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {event.blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  );
}

export function BlockView({ block }: { block: ContentBlock }) {
  if (block.type === "text") {
    return (
      <div className="sl-prose">
        <ReactMarkdown
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
                  textUnderlineOffset: 2,
                }}
              />
            ),
          }}
        >
          {block.text}
        </ReactMarkdown>
      </div>
    );
  }
  if (block.type === "thinking") {
    return (
      <details>
        <summary
          style={{
            cursor: "pointer",
            fontSize: 11,
            color: "var(--af-text-tertiary)",
            marginBottom: 6,
          }}
        >
          Thinking · {block.thinking.length} chars
        </summary>
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.6,
            color: "var(--af-text-secondary)",
            whiteSpace: "pre-wrap",
            fontStyle: "italic",
            borderLeft: "3px solid var(--af-border-subtle)",
            paddingLeft: 12,
            marginTop: 6,
          }}
        >
          {block.thinking}
        </div>
      </details>
    );
  }
  if (block.type === "tool_use") {
    return <ToolUseCard name={block.name} input={block.input} />;
  }
  if (block.type === "tool_result") {
    const text =
      typeof block.content === "string" ? block.content : JSON.stringify(block.content, null, 2);
    return (
      <pre
        style={{
          fontSize: 12,
          padding: 12,
          background: "var(--background)",
          border: "1px solid var(--af-border-subtle)",
          borderRadius: 6,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          color: "var(--af-text)",
          fontFamily: "var(--font-mono)",
          maxHeight: 500,
        }}
      >
        {text}
      </pre>
    );
  }
  return null;
}

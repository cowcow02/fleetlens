"use client";

/**
 * SubagentDrawer — right-side panel opened when the user clicks a
 * sub-agent lane bar on the mini-map. Renders the full run profile:
 * type pill, background badge, timing range, duration, model, parent
 * tool-use id, activity stats (events / messages / tool calls), token
 * breakdown, tools-used pills, the prompt the parent dispatched, and
 * the final agent text. A "Jump to parent" button scrolls the
 * transcript to the Agent tool_use row that kicked the subagent off.
 */
import React from "react";
import { X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SubagentRun } from "@claude-lens/parser";
import { formatGap, formatOffset } from "@/lib/format";
import { subagentColor } from "./colors";
import { StatCell, TokenLine } from "./workflows-shared";
import { shortenToolName } from "../turn-steps";

export function SubagentDrawer({
  subagent,
  onClose,
  onJumpToParent,
}: {
  subagent: SubagentRun;
  onClose: () => void;
  onJumpToParent: () => void;
}) {
  const s = subagent;
  const fill = subagentColor(s.agentType, s.runInBackground);
  const startOff = formatOffset(s.startTOffsetMs);
  const endOff = formatOffset(s.endTOffsetMs);
  const dur = s.durationMs !== undefined ? formatGap(s.durationMs) : "—";
  const totalIn = s.totalUsage.input + s.totalUsage.cacheRead + s.totalUsage.cacheWrite;
  const pctRead = totalIn > 0 ? Math.round((s.totalUsage.cacheRead / totalIn) * 100) : 0;

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
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 10px",
            borderRadius: 4,
            background: fill,
            color: "#fff",
          }}
        >
          {s.agentType}
        </span>
        {s.runInBackground && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              background: "var(--af-warning-subtle)",
              color: "var(--af-warning)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            background
          </span>
        )}
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--af-text)",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={s.description}
        >
          {s.description}
        </span>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--af-text-tertiary)",
            padding: 4,
            borderRadius: 4,
          }}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* Meta strip */}
      <div
        style={{
          padding: "10px 20px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          borderBottom: "1px solid var(--af-border-subtle)",
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          columnGap: 10,
          rowGap: 3,
        }}
      >
        <span style={{ opacity: 0.7 }}>range</span>
        <span style={{ color: "var(--af-text-secondary)" }}>
          {startOff} → {endOff}
        </span>
        <span style={{ opacity: 0.7 }}>duration</span>
        <span style={{ color: "var(--af-text-secondary)" }}>{dur}</span>
        {s.model && (
          <>
            <span style={{ opacity: 0.7 }}>model</span>
            <span style={{ color: "var(--af-text-secondary)" }}>{s.model}</span>
          </>
        )}
        {s.parentToolUseId && (
          <>
            <span style={{ opacity: 0.7 }}>parent</span>
            <span style={{ color: "var(--af-text-secondary)" }}>
              {s.parentToolUseId.slice(0, 24)}…
            </span>
          </>
        )}
      </div>

      {/* Activity stats */}
      <div
        style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--af-border-subtle)",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 10,
        }}
      >
        <StatCell label="Events" value={String(s.eventCount)} />
        <StatCell label="Messages" value={String(s.assistantMessageCount ?? 0)} />
        <StatCell label="Tool calls" value={String(s.toolCallCount ?? 0)} />
      </div>

      {/* Token breakdown */}
      <div
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid var(--af-border-subtle)",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color: "var(--af-text-secondary)",
          display: "flex",
          flexDirection: "column",
          gap: 3,
        }}
      >
        <TokenLine label="Input (fresh)" value={s.totalUsage.input} />
        <TokenLine label="Output" value={s.totalUsage.output} />
        <TokenLine
          label="Cache read"
          value={s.totalUsage.cacheRead}
          suffix={` (${pctRead}%)`}
        />
        <TokenLine label="Cache write" value={s.totalUsage.cacheWrite} />
      </div>

      {/* Tool breakdown */}
      {s.toolCalls && s.toolCalls.length > 0 && (
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--af-border-subtle)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--af-text-tertiary)",
              marginBottom: 8,
            }}
          >
            Tools used
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {s.toolCalls.map((t) => (
              <span
                key={t.name}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: "var(--af-border-subtle)",
                  color: "var(--af-text)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                <b style={{ fontWeight: 600 }}>{shortenToolName(t.name)}</b>
                <span style={{ color: "var(--af-text-tertiary)" }}>×{t.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Parent prompt (what the parent asked the subagent to do) */}
      {s.prompt && (
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--af-border-subtle)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--af-text-tertiary)",
              }}
            >
              Prompt
            </div>
            {s.parentToolUseId && (
              <button
                type="button"
                onClick={onJumpToParent}
                style={{
                  fontSize: 10,
                  color: "var(--af-accent)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Jump to parent →
              </button>
            )}
          </div>
          <div className="sl-prose" style={{ fontSize: 12.5 }}>
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
                    }}
                  />
                ),
              }}
            >
              {s.prompt}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Final text */}
      {s.finalText && (
        <div style={{ padding: "14px 20px" }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--af-text-tertiary)",
              marginBottom: 8,
            }}
          >
            Final result
          </div>
          <div className="sl-prose" style={{ fontSize: 13 }}>
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
                    }}
                  />
                ),
              }}
            >
              {s.finalText}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

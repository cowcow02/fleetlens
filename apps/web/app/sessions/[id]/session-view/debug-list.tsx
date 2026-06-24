"use client";

/**
 * DebugList — renders the Log tab's raw event stream as a list of
 * collapsible JSON entries.
 *
 * Notes:
 *  - We rebuild a JSON view from the structured fields on the event.
 *    The original `raw` field is stripped server-side before
 *    serialization (see app/sessions/[id]/page.tsx) because including
 *    the full JSONL line per event doubles the RSC payload on large
 *    sessions. All the useful data is already on the structured event;
 *    this view surfaces it in the same shape you'd get from the raw
 *    JSONL.
 */
import React from "react";
import type { SessionEvent } from "@claude-lens/parser";

export function DebugList({ events }: { events: SessionEvent[] }) {
  const shapeForDebug = (e: SessionEvent) => ({
    type: e.rawType,
    index: e.index,
    uuid: e.uuid,
    parentUuid: e.parentUuid,
    timestamp: e.timestamp,
    role: e.role,
    messageId: e.messageId,
    stopReason: e.stopReason,
    model: e.model,
    requestId: e.requestId,
    toolName: e.toolName,
    toolUseId: e.toolUseId,
    attachmentType: e.attachmentType,
    usage: e.usage,
    blocks: e.blocks,
  });

  return (
    <div style={{ padding: "8px 0" }}>
      {events.map((e) => (
        <details
          key={e.index}
          style={{
            borderBottom: "1px solid var(--af-border-subtle)",
            padding: "8px 12px",
          }}
        >
          <summary
            style={{
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--af-text-secondary)",
            }}
          >
            #{e.index} · {e.rawType}
            {e.attachmentType ? `/${e.attachmentType}` : ""} · {e.timestamp ?? "(no ts)"}
          </summary>
          <pre
            style={{
              marginTop: 8,
              padding: 12,
              background: "var(--background)",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 6,
              fontSize: 11,
              overflow: "auto",
              maxHeight: 400,
              color: "var(--af-text-secondary)",
            }}
          >
            {JSON.stringify(shapeForDebug(e), null, 2)}
          </pre>
        </details>
      ))}
    </div>
  );
}

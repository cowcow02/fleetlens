"use client";

/**
 * Token display chips.
 *
 * - `TokenChip` — per-event token chip showing `{cache-inflated input} /
 *   output`. Used in event rows.
 * - `TurnTokenChip` — per-turn aggregate. Primary display is fresh
 *   input / output (not the cache-inflated sum), consistent with the
 *   session header. Tooltip shows the full breakdown plus a footnote
 *   reminding that cache reads are cumulative across all requests in
 *   the turn.
 */
import React, { useState } from "react";
import type { SessionEvent } from "@claude-lens/parser";
import { formatTokens } from "@/lib/format";
import { Tooltip, TooltipRow } from "./tooltip";

export function TokenChip({
  usage,
}: {
  usage: NonNullable<SessionEvent["usage"]>;
}) {
  const [hover, setHover] = useState(false);
  const totalIn = usage.input + usage.cacheRead + usage.cacheWrite;
  const pctRead = totalIn > 0 ? Math.round((usage.cacheRead / totalIn) * 100) : 0;
  return (
    <span
      style={{
        position: "relative",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--af-text-secondary)",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        whiteSpace: "nowrap",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span style={{ opacity: 0.6 }}>▤</span>
      {formatTokens(totalIn)} / {formatTokens(usage.output)}
      {hover && (
        <Tooltip style={{ right: 0, top: "calc(100% + 6px)", minWidth: 180 }}>
          <TooltipRow label="Input" value={usage.input.toLocaleString()} />
          <TooltipRow
            label="Cache read"
            value={`${usage.cacheRead.toLocaleString()} (${pctRead}%)`}
          />
          <TooltipRow label="Cache write" value={usage.cacheWrite.toLocaleString()} />
          <TooltipRow label="Output" value={usage.output.toLocaleString()} />
        </Tooltip>
      )}
    </span>
  );
}

export function TurnTokenChip({
  usage,
}: {
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}) {
  const [hover, setHover] = useState(false);
  const totalIn = usage.input + usage.cacheRead + usage.cacheWrite;
  const pctRead = totalIn > 0 ? Math.round((usage.cacheRead / totalIn) * 100) : 0;
  return (
    <span
      style={{
        position: "relative",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--af-text-tertiary)",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        whiteSpace: "nowrap",
        cursor: "default",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span style={{ opacity: 0.6 }}>▤</span>
      {formatTokens(usage.input)} / {formatTokens(usage.output)}
      {hover && (
        <Tooltip style={{ right: 0, top: "calc(100% + 6px)", minWidth: 220 }}>
          <TooltipRow label="Input (fresh)" value={usage.input.toLocaleString()} />
          <TooltipRow label="Output" value={usage.output.toLocaleString()} />
          <TooltipRow
            label="Cache read"
            value={`${usage.cacheRead.toLocaleString()} (${pctRead}%)`}
          />
          <TooltipRow label="Cache write" value={usage.cacheWrite.toLocaleString()} />
          <div
            style={{
              marginTop: 6,
              paddingTop: 6,
              borderTop: "1px solid rgba(241,245,249,0.12)",
              opacity: 0.65,
              fontSize: 10,
              whiteSpace: "normal",
              lineHeight: 1.4,
            }}
          >
            Cumulative across all requests in this turn.
          </div>
        </Tooltip>
      )}
    </span>
  );
}

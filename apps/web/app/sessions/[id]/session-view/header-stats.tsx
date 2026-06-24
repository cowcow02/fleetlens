"use client";

/**
 * Header stats + token stat with anchored tooltip.
 *
 * - InlineStat / InlineStatDivider — compact icon+value chips used in the
 *   single-line session header, modeled on Claude's Sessions page.
 * - EntrypointBadge — colors `cli` / `claude-desktop` (green, human-driven)
 *   vs `sdk-*` (amber, programmatic).
 * - InlineTokenStat — session-header token chip with a tooltip that
 *   escapes the header's overflow:hidden ancestor via getBoundingClientRect
 *   + position:fixed (`useAnchoredTooltip` + `AnchoredTooltip`).
 *
 * `useAnchoredTooltip` is a hook — it must be defined and consumed inside
 * a component (no hook calls at module load).
 */
import React, { useRef, useState } from "react";
import type { SessionEvent } from "@claude-lens/parser";
import { formatTokens } from "@/lib/format";
import { TooltipRow } from "./tooltip";

export function InlineStat({
  icon,
  value,
  mono,
  truncate,
}: {
  icon?: React.ReactNode;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 12,
        color: "var(--af-text-secondary)",
        maxWidth: truncate ? 260 : undefined,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {icon && (
        <span
          style={{
            display: "inline-flex",
            color: "var(--af-text-tertiary)",
          }}
        >
          {icon}
        </span>
      )}
      <span
        style={{
          fontFamily: mono ? "var(--font-mono)" : "inherit",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </span>
  );
}

export function InlineStatDivider() {
  return (
    <span
      style={{
        color: "var(--af-text-tertiary)",
        fontSize: 11,
        opacity: 0.6,
      }}
    >
      ·
    </span>
  );
}

export function EntrypointBadge({ entrypoint }: { entrypoint: string }) {
  const isSdk = entrypoint.startsWith("sdk-");
  const tone = isSdk
    ? { bg: "rgba(245, 158, 11, 0.16)", fg: "#b45309" }
    : { bg: "rgba(16, 185, 129, 0.16)", fg: "#047857" };
  return (
    <span
      title={`entrypoint: ${entrypoint}`}
      style={{
        fontSize: 10.5,
        padding: "2px 7px",
        borderRadius: 4,
        background: tone.bg,
        color: tone.fg,
        fontWeight: 600,
        fontFamily: "var(--font-mono)",
        letterSpacing: 0.2,
      }}
    >
      {entrypoint}
    </span>
  );
}

export function useAnchoredTooltip() {
  const ref = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const open = () => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setAnchor({ top: r.bottom + 6, left: r.left });
  };
  const close = () => setAnchor(null);
  return { ref, anchor, open, close };
}

export function AnchoredTooltip({
  anchor,
  width,
  children,
}: {
  anchor: { top: number; left: number };
  width: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "fixed",
        top: anchor.top,
        left: anchor.left,
        zIndex: 1000,
        background: "#1A1A1A",
        color: "#F5F1EC",
        padding: "8px 12px",
        borderRadius: 6,
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        lineHeight: 1.5,
        pointerEvents: "none",
        boxShadow: "0 4px 16px rgba(15,23,42,0.24)",
        width,
      }}
    >
      {children}
    </div>
  );
}

export function InlineTokenStat({ usage }: { usage: SessionEvent["usage"] }) {
  const { ref, anchor, open, close } = useAnchoredTooltip();
  const u = usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const totalIn = u.input + u.cacheRead + u.cacheWrite;
  const pctRead = totalIn > 0 ? Math.round((u.cacheRead / totalIn) * 100) : 0;
  const cached = u.cacheRead + u.cacheWrite;

  return (
    <span
      ref={ref}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        color: "var(--af-text-secondary)",
        cursor: "default",
        fontFamily: "var(--font-mono)",
      }}
      onMouseEnter={open}
      onMouseLeave={close}
    >
      <span>
        {formatTokens(u.input)}
        <span style={{ color: "var(--af-text-tertiary)", margin: "0 3px" }}>in</span>
        {formatTokens(u.output)}
        <span style={{ color: "var(--af-text-tertiary)", marginLeft: 3 }}>out</span>
      </span>
      {cached > 0 && (
        <span
          style={{
            fontSize: 10.5,
            color: "var(--af-text-tertiary)",
            paddingLeft: 6,
            borderLeft: "1px solid var(--af-border-subtle)",
          }}
        >
          +{formatTokens(cached)} cached
        </span>
      )}
      {anchor && (
        <AnchoredTooltip anchor={anchor} width={280}>
          <TooltipRow label="Input (fresh)" value={u.input.toLocaleString()} />
          <TooltipRow label="Output" value={u.output.toLocaleString()} />
          <TooltipRow label="Cache read" value={`${u.cacheRead.toLocaleString()} (${pctRead}%)`} />
          <TooltipRow label="Cache write" value={u.cacheWrite.toLocaleString()} />
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
            Cache reads are cumulative across all API requests and billed at ~10% of regular input.
          </div>
        </AnchoredTooltip>
      )}
    </span>
  );
}

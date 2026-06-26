"use client";

/**
 * Tooltip + TooltipRow — generic absolutely-positioned tooltip used by
 * inline header stats, token chips, hover cards, etc. The parent owns
 * positioning via the `style` prop; this component only handles the
 * shell (background, border-radius, pointer-events: none).
 *
 * TooltipRow is a small key/value row helper for the common
 * label-on-left / value-on-right pattern inside a Tooltip.
 */
import React, { type CSSProperties } from "react";

export function Tooltip({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        position: "absolute",
        zIndex: 100,
        background: "#1A1A1A",
        color: "#F5F1EC",
        borderRadius: 8,
        padding: "10px 12px",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        lineHeight: 1.5,
        boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
        pointerEvents: "none",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function TooltipRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

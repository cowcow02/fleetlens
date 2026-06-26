"use client";

/**
 * Small layout helpers shared between SubagentDrawer and WorkflowsPanel.
 *
 * - WfMiniStat — inline icon+value chip used in workflow card headers.
 * - SectionLabel — small all-caps label above a content section.
 * - StatCell — 3-column "Events / Messages / Tool calls" stat grid cell.
 * - TokenLine — label-value row for a token breakdown.
 */
import React from "react";

export function WfMiniStat({
  icon,
  value,
}: {
  icon?: React.ReactNode;
  value: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11.5,
        color: "var(--af-text-secondary)",
        fontFamily: "var(--font-mono)",
        whiteSpace: "nowrap",
      }}
    >
      {icon && (
        <span style={{ color: "var(--af-text-tertiary)", display: "inline-flex" }}>{icon}</span>
      )}
      {value}
    </span>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </div>
  );
}

export function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          color: "var(--af-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          fontFamily: "var(--font-mono)",
          color: "var(--af-text)",
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function TokenLine({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span>
        {value.toLocaleString()}
        {suffix && <span style={{ opacity: 0.65 }}>{suffix}</span>}
      </span>
    </div>
  );
}

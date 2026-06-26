"use client";
import { type ReactNode } from "react";
import { ExportPdfButton } from "./export-pdf-button";

type Period = "week" | "month";

export function DigestActions({
  digestKey,
  period,
  hasDigest,
  narrativeFresh,
  isStreaming,
  aiEnabled,
  progress,
  onGenerate,
  onReroll,
  rerollTitle,
}: {
  digestKey: string;
  period: Period;
  hasDigest: boolean;
  narrativeFresh: boolean;
  isStreaming: boolean;
  aiEnabled: boolean;
  progress: string;
  onGenerate: () => void;
  onReroll: () => void;
  rerollTitle?: string;
}): ReactNode {
  const defaultRerollTitle = `Re-roll the narrative for this ${period}`;
  const pdfAction = hasDigest ? <ExportPdfButton digestKey={`${period}-${digestKey}`} /> : null;

  let actions: ReactNode = null;
  if (!narrativeFresh && aiEnabled) {
    actions = (
      <button
        onClick={onGenerate}
        disabled={isStreaming}
        style={btnPrimary(isStreaming)}
      >
        {isStreaming ? "Generating..." : hasDigest ? "Generate" : "Generate digest"}
      </button>
    );
  } else if (aiEnabled) {
    actions = (
      <span style={{ fontSize: 10, color: "var(--af-text-tertiary)", display: "inline-flex", gap: 6, alignItems: "center" }}>
        ✓ Up to date
        <button
          onClick={onReroll}
          disabled={isStreaming}
          title={rerollTitle ?? defaultRerollTitle}
          style={btnSecondary(isStreaming)}
        >
          {isStreaming ? "..." : "Re-roll"}
        </button>
      </span>
    );
  }
  if (progress) {
    actions = (
      <>
        {actions}
        <span style={{ fontSize: 10, color: "var(--af-text-tertiary)" }}>{progress}</span>
      </>
    );
  }
  if (pdfAction) {
    actions = (
      <>
        {actions}
        {pdfAction}
      </>
    );
  }
  return actions;
}

function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    background: "var(--af-accent)",
    color: "white",
    border: "none",
    borderRadius: 5,
    cursor: disabled ? "default" : "pointer",
    fontSize: 11,
    fontWeight: 600,
    opacity: disabled ? 0.6 : 1,
  };
}

function btnSecondary(disabled: boolean): React.CSSProperties {
  return {
    padding: "2px 7px",
    background: "transparent",
    border: "1px solid var(--af-border-subtle)",
    borderRadius: 4,
    fontSize: 10,
    color: "var(--af-text-secondary)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

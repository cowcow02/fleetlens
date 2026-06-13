"use client";

import type { ReactNode } from "react";

// Shared control kit. Styles live in globals.css under "Control kit" — these
// wrappers exist so panels never reach for native checkboxes or ad-hoc inline
// styles. Add here first; if a control appears twice in panels it belongs here.

/** Checkbox rendered as an editorial chip. `implied` = effectively on because
 *  a broader default covers it (rendered dashed, still clickable). */
export function CheckChip({
  checked,
  implied = false,
  onChange,
  children,
}: {
  checked: boolean;
  implied?: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label className={`check-chip ${checked ? "checked" : ""} ${implied ? "implied" : ""}`}>
      <input type="checkbox" checked={checked || implied} onChange={onChange} />
      <span className="chip-box" aria-hidden />
      {children}
    </label>
  );
}

/** One-line connection status: green/red dot + segments separated by dots. */
export function StatusStrip({ ok, segments }: { ok: boolean; segments: ReactNode[] }) {
  return (
    <div className={`status-strip ${ok ? "" : "error"}`}>
      <span className="status-dot" aria-hidden />
      {segments.map((s, i) => (
        <span key={i} style={{ display: "inline-flex", gap: 10, alignItems: "baseline" }}>
          {i > 0 && <span className="sep">·</span>}
          {s}
        </span>
      ))}
    </div>
  );
}

export function Callout({ tone = "info", children }: { tone?: "info" | "error"; children: ReactNode }) {
  return <div className={`callout ${tone === "error" ? "error" : ""}`}>{children}</div>;
}

/** Provider auth failures carry the upstream status; anything else (DNS,
 *  offline laptop, timeouts → "fetch failed") is transient and self-heals on
 *  the hourly sweep — don't tell the admin to rotate credentials for those. */
export function isAuthSyncError(lastError: string | null | undefined): boolean {
  return /HTTP 40[13]/.test(lastError ?? "");
}

/** Selectable row for picker lists (custom check mark, name, right-aligned meta). */
export function PickerRow({
  selected,
  onToggle,
  name,
  tag,
  meta,
}: {
  selected: boolean;
  onToggle: () => void;
  name: string;
  tag?: string;
  meta?: string;
}) {
  return (
    <label className={`picker-row ${selected ? "selected" : ""}`}>
      <input type="checkbox" checked={selected} onChange={onToggle} />
      <span className="pick-mark" aria-hidden />
      <span className="pick-name">{name}</span>
      {tag && <span className="badge-tag">{tag}</span>}
      {meta && <span className="pick-meta">{meta}</span>}
    </label>
  );
}

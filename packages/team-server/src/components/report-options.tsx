"use client";

import { useEffect, useState } from "react";
import { PickerRow } from "./ui";

export type ReportOption = {
  key: string;
  label: string;
  description: string;
  active: boolean;
  href: string; // navigating applies the toggle server-side
};

// Collapses the report's view toggles (mock / explain / coaching) into one
// Options button + modal. Each toggle is a navigation: the server re-renders
// with the flag flipped, so state never lives on the client.
export function ReportOptions({ options }: { options: ReportOption[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button className="btn secondary" onClick={() => setOpen(true)}>
        <span aria-hidden style={{ marginRight: 6 }}>⚙</span> Options
      </button>
      {open && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="modal report-options" role="dialog" aria-modal="true" aria-labelledby="report-options-title">
            <h2 id="report-options-title">Report options</h2>
            <div className="modal-body">
              {options.map((o) => (
                <PickerRow
                  key={o.key}
                  selected={o.active}
                  onToggle={() => {
                    window.location.href = o.href;
                  }}
                  name={o.label}
                  meta={o.description}
                />
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

"use client";

import { useState, useEffect } from "react";

export type RangePreset = "current" | "24h" | "7d" | "30d" | "90d" | "custom";

export type DateRange = {
  preset: RangePreset;
  /** Absolute start timestamp (ms). Undefined when preset === "current". */
  startMs?: number;
  /** Absolute end timestamp (ms). Undefined when preset === "current". */
  endMs?: number;
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "current", label: "Current cycle" },
  { key: "24h", label: "24H" },
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "custom", label: "Custom" },
];

export function resolveRange(range: DateRange): { startMs?: number; endMs?: number } {
  const now = Date.now();
  switch (range.preset) {
    case "current":
      return {};
    case "24h":
      return { startMs: now - 24 * HOUR, endMs: now };
    case "7d":
      return { startMs: now - 7 * DAY, endMs: now };
    case "30d":
      return { startMs: now - 30 * DAY, endMs: now };
    case "90d":
      return { startMs: now - 90 * DAY, endMs: now };
    case "custom":
      return { startMs: range.startMs, endMs: range.endMs };
  }
}

export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
}) {
  const [customStart, setCustomStart] = useState<string>(() =>
    toDatetimeLocal(value.startMs ?? Date.now() - 7 * DAY),
  );
  const [customEnd, setCustomEnd] = useState<string>(() =>
    toDatetimeLocal(value.endMs ?? Date.now()),
  );

  // Auto-apply when the user changes custom datetime inputs.
  useEffect(() => {
    if (value.preset !== "custom") return;
    const startMs = fromDatetimeLocal(customStart);
    const endMs = fromDatetimeLocal(customEnd);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return;
    if (startMs >= endMs) return;
    // Only fire if something actually changed.
    if (startMs !== value.startMs || endMs !== value.endMs) {
      onChange({ preset: "custom", startMs, endMs });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customStart, customEnd, value.preset]);

  const selectPreset = (preset: RangePreset) => {
    if (preset === "custom") {
      onChange({
        preset,
        startMs: fromDatetimeLocal(customStart),
        endMs: fromDatetimeLocal(customEnd),
      });
    } else {
      onChange({ preset });
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          borderRadius: 6,
          border: "1px solid var(--af-border-subtle)",
          overflow: "hidden",
        }}
      >
        {PRESETS.map((p, i) => (
          <button
            key={p.key}
            type="button"
            onClick={() => selectPreset(p.key)}
            style={{
              padding: "6px 12px",
              fontSize: 11,
              fontWeight: 500,
              background:
                value.preset === p.key ? "var(--af-accent-subtle)" : "transparent",
              color:
                value.preset === p.key ? "var(--af-accent)" : "var(--af-text-secondary)",
              border: "none",
              borderRight:
                i < PRESETS.length - 1 ? "1px solid var(--af-border-subtle)" : "none",
              cursor: "pointer",
              letterSpacing: "0.02em",
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      {value.preset === "custom" && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="datetime-local"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            style={datetimeInputStyle}
          />
          <span style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>→</span>
          <input
            type="datetime-local"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            style={datetimeInputStyle}
          />
        </div>
      )}
    </div>
  );
}

const datetimeInputStyle: React.CSSProperties = {
  padding: "5px 8px",
  fontSize: 11,
  background: "var(--background)",
  color: "var(--af-text)",
  border: "1px solid var(--af-border-subtle)",
  borderRadius: 5,
  fontFamily: "var(--font-mono)",
};

/** Format a ms timestamp as YYYY-MM-DDTHH:MM for <input type="datetime-local">. */
function toDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${da}T${h}:${mi}`;
}

function fromDatetimeLocal(value: string): number {
  const d = new Date(value);
  return d.getTime();
}

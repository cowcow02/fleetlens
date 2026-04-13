"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { UsageSnapshot } from "@/lib/usage-data";
import { UsageChart } from "@/components/usage-chart";
import { UsageChartRange } from "@/components/usage-chart-range";
import { OptionalChart } from "@/components/optional-chart";
import {
  DateRangePicker,
  resolveRange,
  type DateRange,
} from "@/components/date-range-picker";

type SeriesKey = "five_hour" | "seven_day" | "seven_day_sonnet";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type WindowConfig = {
  key: SeriesKey;
  label: string;
  windowMs: number;
  colorVar: string;
};

const MAIN_WINDOWS: WindowConfig[] = [
  { key: "seven_day", label: "7d utilization", windowMs: 7 * DAY, colorVar: "var(--af-accent)" },
  { key: "five_hour", label: "5h utilization", windowMs: 5 * HOUR, colorVar: "var(--af-success)" },
];

const SONNET_WINDOW: WindowConfig = {
  key: "seven_day_sonnet",
  label: "7d utilization (Sonnet)",
  windowMs: 7 * DAY,
  colorVar: "var(--af-warning)",
};

/**
 * Client-side wrapper that renders the usage chart grid and manages
 * a fullscreen modal for any individual chart.
 *
 * The page is a server component that reads snapshots from disk; this
 * component receives them as a prop and handles purely the interaction
 * layer (2-col grid, expand-to-modal).
 */
export function UsageChartsDashboard({ snapshots }: { snapshots: UsageSnapshot[] }) {
  const [expanded, setExpanded] = useState<WindowConfig | null>(null);

  // Close on Escape.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  // Lock body scroll while the modal is open.
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [expanded]);

  return (
    <>
      {MAIN_WINDOWS.map((w) => (
        <section
          key={w.key}
          style={{ display: "flex", flexDirection: "column", gap: 6 }}
        >
          <SectionLabel>{w.label}</SectionLabel>
          <UsageChart
            snapshots={snapshots}
            seriesKey={w.key}
            windowMs={w.windowMs}
            colorVar={w.colorVar}
            onExpand={() => setExpanded(w)}
          />
        </section>
      ))}

      <OptionalChart storageKey="cclens:usage:show-sonnet" label="Sonnet 7d utilization">
        <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <SectionLabel>{SONNET_WINDOW.label}</SectionLabel>
          <UsageChart
            snapshots={snapshots}
            seriesKey={SONNET_WINDOW.key}
            windowMs={SONNET_WINDOW.windowMs}
            colorVar={SONNET_WINDOW.colorVar}
            onExpand={() => setExpanded(SONNET_WINDOW)}
          />
        </section>
      </OptionalChart>

      {expanded && (
        <ExpandedModal
          config={expanded}
          snapshots={snapshots}
          onClose={() => setExpanded(null)}
        />
      )}
    </>
  );
}

function ExpandedModal({
  config,
  snapshots,
  onClose,
}: {
  config: WindowConfig;
  snapshots: UsageSnapshot[];
  onClose: () => void;
}) {
  const [range, setRange] = useState<DateRange>({ preset: "current" });
  const resolved = resolveRange(range);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.55)",
        backdropFilter: "blur(4px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 1600,
          maxHeight: "calc(100vh - 64px)",
          background: "var(--background)",
          border: "1px solid var(--af-border-subtle)",
          borderRadius: 12,
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.4)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Modal header: title + range picker + close */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            padding: "14px 20px",
            borderBottom: "1px solid var(--af-border-subtle)",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--af-text)",
            }}
          >
            {config.label}
          </div>
          <DateRangePicker value={range} onChange={setRange} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "transparent",
              border: "1px solid var(--af-border-subtle)",
              color: "var(--af-text-secondary)",
              cursor: "pointer",
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Modal body: either single-cycle burndown or multi-cycle line */}
        <div
          style={{
            padding: 20,
            overflow: "auto",
            flex: 1,
          }}
        >
          {range.preset === "current" || !resolved.startMs || !resolved.endMs ? (
            <UsageChart
              snapshots={snapshots}
              seriesKey={config.key}
              windowMs={config.windowMs}
              colorVar={config.colorVar}
            />
          ) : (
            <UsageChartRange
              snapshots={snapshots}
              seriesKey={config.key}
              startMs={resolved.startMs}
              endMs={resolved.endMs}
              windowMs={config.windowMs}
              colorVar={config.colorVar}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--af-text)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </div>
  );
}

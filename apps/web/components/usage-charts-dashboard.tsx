"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { UsageSnapshot } from "@/lib/usage-data";
import type { PredictedSeriesByKey } from "@/lib/calibration-data";
import { UsageChart } from "@/components/usage-chart";
import { UsageChartRange } from "@/components/usage-chart-range";
import { OptionalChart } from "@/components/optional-chart";
import {
  DateRangePicker,
  resolveRange,
  type DateRange,
} from "@/components/date-range-picker";

type SeriesKey = "five_hour" | "seven_day" | "seven_day_sonnet" | "monthly";

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
export function UsageChartsDashboard({
  snapshots,
  predicted,
  /** Override default 5h/7d window labels (e.g. Grok context window). */
  windows,
  hideSonnet,
}: {
  snapshots: UsageSnapshot[];
  predicted?: PredictedSeriesByKey;
  windows?: WindowConfig[];
  hideSonnet?: boolean;
}) {
  const [expanded, setExpanded] = useState<WindowConfig | null>(null);
  const emptyPredicted: PredictedSeriesByKey = {
    five_hour: [],
    seven_day: [],
    seven_day_sonnet: [],
  };
  const pred = predicted ?? emptyPredicted;
  const mainWindows = windows ?? MAIN_WINDOWS;

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
      {mainWindows.map((w) => (
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
            predictedSeries={w.key === "monthly" ? undefined : pred[w.key]}
            onExpand={() => setExpanded(w)}
          />
        </section>
      ))}

      {!hideSonnet && (
      <OptionalChart storageKey="cclens:usage:show-sonnet" label="Sonnet 7d utilization">
        <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <SectionLabel>{SONNET_WINDOW.label}</SectionLabel>
          <UsageChart
            snapshots={snapshots}
            seriesKey={SONNET_WINDOW.key}
            windowMs={SONNET_WINDOW.windowMs}
            colorVar={SONNET_WINDOW.colorVar}
            predictedSeries={pred[SONNET_WINDOW.key]}
            onExpand={() => setExpanded(SONNET_WINDOW)}
          />
        </section>
      </OptionalChart>
      )}

      {expanded && (
        <ExpandedModal
          config={expanded}
          snapshots={snapshots}
          predictedSeries={expanded.key === "monthly" ? undefined : pred[expanded.key]}
          onClose={() => setExpanded(null)}
        />
      )}
    </>
  );
}

function ExpandedModal({
  config,
  snapshots,
  predictedSeries,
  onClose,
}: {
  config: WindowConfig;
  snapshots: UsageSnapshot[];
  predictedSeries?: { capturedAt: number; util: number }[];
  onClose: () => void;
}) {
  const [range, setRange] = useState<DateRange>({ preset: "current" });

  // "Current cycle" → snap the range to the latest known cycle boundaries
  // so the same chart component can render it using the same layout as
  // all the other presets.
  const currentCycleBounds = useMemo(() => {
    for (let i = snapshots.length - 1; i >= 0; i--) {
      const w = snapshots[i]![config.key];
      if (w && w.resets_at) {
        const endMs = new Date(w.resets_at).getTime();
        if (config.key === "monthly") {
          const end = new Date(endMs);
          return {
            startMs: Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1),
            endMs,
          };
        }
        return { startMs: endMs - config.windowMs, endMs };
      }
    }
    return null;
  }, [snapshots, config.key, config.windowMs]);

  const resolvedBase = resolveRange(range);
  const resolved =
    range.preset === "current" && currentCycleBounds
      ? currentCycleBounds
      : resolvedBase;

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
          <DateRangePicker
            value={range}
            onChange={setRange}
            windowType={config.windowMs >= DAY ? "long" : "short"}
          />
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

        {/* Modal body — unified: UsageChartRange for every preset, with
            'Current cycle' mapped to the latest cycle's exact bounds. */}
        <div
          style={{
            padding: 20,
            overflow: "auto",
            flex: 1,
          }}
        >
          {resolved.startMs && resolved.endMs ? (
            <UsageChartRange
              snapshots={snapshots}
              seriesKey={config.key}
              startMs={resolved.startMs}
              endMs={resolved.endMs}
              windowMs={config.windowMs}
              colorVar={config.colorVar}
              predictedSeries={predictedSeries}
            />
          ) : (
            <div
              className="af-card"
              style={{
                padding: "40px 32px",
                textAlign: "center",
                fontSize: 12,
                color: "var(--af-text-tertiary)",
              }}
            >
              No data available for this window.
            </div>
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

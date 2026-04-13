/**
 * Claude Code usage page — historical utilization analytics.
 *
 * Current utilization lives in the sidebar (always visible). This page
 * is dedicated to historical views, trend analysis, and leadership
 * reporting metrics derived from the daemon's snapshot log.
 *
 * Reads from ~/.cclens/usage.jsonl — no API endpoint needed.
 */

import { Activity } from "lucide-react";
import { readUsageSnapshots, latestUsageSnapshot } from "@/lib/usage-data";
import { UsageChart } from "@/components/usage-chart";
import { OptionalChart } from "@/components/optional-chart";

export const dynamic = "force-dynamic";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export default function UsagePage() {
  const snapshots = readUsageSnapshots();
  const latest = latestUsageSnapshot();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 28,
        maxWidth: 1400,
        padding: "32px 40px",
      }}
    >
      {/* Header */}
      <header>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Activity size={22} />
          Usage history
        </h1>
        <p
          style={{
            fontSize: 12,
            color: "var(--af-text-tertiary)",
            marginTop: 6,
            maxWidth: 720,
          }}
        >
          Historical plan utilization derived from the{" "}
          <code
            style={{
              background: "var(--af-surface)",
              padding: "1px 6px",
              borderRadius: 4,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
            }}
          >
            cclens
          </code>{" "}
          daemon&apos;s snapshot log. Current utilization is always visible in the sidebar.
        </p>
      </header>

      {!latest ? (
        <EmptyState />
      ) : (
        <>
          {/* 7-day window — primary leadership metric */}
          <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <SectionLabel>7-day cycle — the real license signal</SectionLabel>
            <UsageChart
              snapshots={snapshots}
              seriesKey="seven_day"
              title="7 day window (all models)"
              windowMs={7 * DAY}
              colorVar="var(--af-accent)"
            />
          </section>

          {/* 5h burst control — collapsible, tactical */}
          <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <SectionLabel>5-hour burst control</SectionLabel>
            <UsageChart
              snapshots={snapshots}
              seriesKey="five_hour"
              title="5 hour window"
              windowMs={5 * HOUR}
              colorVar="var(--af-success)"
            />
          </section>

          {/* Sonnet — rarely useful, hidden by default */}
          <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <OptionalChart storageKey="cclens:usage:show-sonnet" label="Sonnet 7-day window">
              <UsageChart
                snapshots={snapshots}
                seriesKey="seven_day_sonnet"
                title="7 day window (Sonnet)"
                windowMs={7 * DAY}
                colorVar="var(--af-warning)"
              />
            </OptionalChart>
          </section>

          <section
            style={{
              fontSize: 11,
              color: "var(--af-text-tertiary)",
              fontFamily: "var(--font-mono)",
            }}
            suppressHydrationWarning
          >
            Last daemon poll: {new Date(latest.captured_at).toLocaleString()} ·{" "}
            {snapshots.length} snapshot{snapshots.length === 1 ? "" : "s"} on disk
          </section>
        </>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: "var(--af-text-tertiary)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {children}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="af-card"
      style={{
        padding: "48px 32px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: "var(--af-text)",
        }}
      >
        No usage data yet
      </div>
      <p
        style={{
          fontSize: 12,
          color: "var(--af-text-tertiary)",
          marginTop: 8,
        }}
      >
        Start the polling daemon to begin collecting metrics every 5 minutes:
      </p>
      <pre
        style={{
          display: "inline-block",
          marginTop: 14,
          background: "var(--background)",
          border: "1px solid var(--af-border-subtle)",
          padding: "8px 16px",
          borderRadius: 6,
          fontSize: 13,
          fontFamily: "var(--font-mono)",
          color: "var(--af-text)",
        }}
      >
        cclens daemon start
      </pre>
      <p
        style={{
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          marginTop: 16,
        }}
      >
        For a one-shot snapshot without the daemon, run{" "}
        <code
          style={{
            background: "var(--background)",
            padding: "1px 6px",
            borderRadius: 4,
            fontFamily: "var(--font-mono)",
          }}
        >
          cclens usage
        </code>
        .
      </p>
    </div>
  );
}

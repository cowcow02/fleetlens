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
import { UsageChartsDashboard } from "@/components/usage-charts-dashboard";

export const dynamic = "force-dynamic";

export default function UsagePage() {
  const snapshots = readUsageSnapshots();
  const latest = latestUsageSnapshot();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
        maxWidth: 1400,
        padding: "20px 32px",
      }}
    >
      {/* Header */}
      <header
        style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}
      >
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Activity size={18} />
          Usage history
        </h1>
        <span style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>
          historical plan utilization · current usage in sidebar
        </span>
      </header>

      {!latest ? (
        <EmptyState />
      ) : (
        <>
          <UsageChartsDashboard snapshots={snapshots} />
          <div
            style={{
              fontSize: 11,
              color: "var(--af-text-tertiary)",
              fontFamily: "var(--font-mono)",
            }}
            suppressHydrationWarning
          >
            Last daemon poll: {new Date(latest.captured_at).toLocaleString()} ·{" "}
            {snapshots.length} snapshot{snapshots.length === 1 ? "" : "s"} on disk
          </div>
        </>
      )}
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

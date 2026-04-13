/**
 * Claude Code usage page — 5h/7d utilization gauges + per-window burndown charts.
 *
 * Reads from ~/.cclens/usage.jsonl (written by the cclens daemon).
 * No API endpoint — direct file read on the server.
 */

import Link from "next/link";
import { ArrowLeft, Activity } from "lucide-react";
import { readUsageSnapshots, latestUsageSnapshot } from "@/lib/usage-data";
import { UsageGauges } from "@/components/usage-gauges";
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
        maxWidth: 1280,
        padding: "32px 40px",
      }}
    >
      {/* Breadcrumb */}
      <div style={{ fontSize: 12, color: "var(--af-text-tertiary)" }}>
        <Link
          href="/"
          style={{
            color: "var(--af-text-tertiary)",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <ArrowLeft size={12} /> Dashboard
        </Link>
      </div>

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
          Claude Code Usage
        </h1>
        <p
          style={{
            fontSize: 12,
            color: "var(--af-text-tertiary)",
            marginTop: 6,
            maxWidth: 720,
          }}
        >
          Plan utilization over rolling 5-hour and 7-day windows. Same numbers Claude Code&apos;s{" "}
          <code
            style={{
              background: "var(--af-surface)",
              padding: "1px 6px",
              borderRadius: 4,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
            }}
          >
            /usage
          </code>{" "}
          slash command shows.
        </p>
      </header>

      {!latest ? (
        <EmptyState />
      ) : (
        <>
          <section>
            <SectionLabel>Current</SectionLabel>
            <UsageGauges snapshot={latest} />
          </section>

          <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <SectionLabel>History</SectionLabel>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 16,
              }}
            >
              <UsageChart
                snapshots={snapshots}
                seriesKey="five_hour"
                title="5 hour window"
                windowMs={5 * HOUR}
                colorVar="var(--af-success)"
              />
              <UsageChart
                snapshots={snapshots}
                seriesKey="seven_day"
                title="7 day window (all)"
                windowMs={7 * DAY}
                colorVar="var(--af-accent)"
              />
            </div>
            <OptionalChart storageKey="cclens:usage:show-sonnet" label="Sonnet window">
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
          >
            Last updated: {new Date(latest.captured_at).toLocaleString()}
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
        marginBottom: 12,
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

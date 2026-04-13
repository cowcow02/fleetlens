import Link from "next/link";
import type { UsageSnapshot, UsageWindow } from "@/lib/usage-data";

/**
 * Compact current-usage widget for the sidebar. Always visible on every page.
 * Shows the latest snapshot's 5h and 7d utilization with thin progress bars.
 *
 * For full history and leadership metrics, click through to /usage.
 */
export function UsageSidebar({ snapshot }: { snapshot: UsageSnapshot | null }) {
  if (!snapshot) {
    return (
      <div
        style={{
          padding: "10px 16px 12px",
          borderTop: "1px solid var(--af-border-subtle)",
          fontSize: 10,
          color: "var(--af-text-tertiary)",
          lineHeight: 1.4,
        }}
      >
        <div style={{ textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 4 }}>
          Usage
        </div>
        <div>
          Run <code style={{ fontFamily: "var(--font-mono)" }}>cclens daemon start</code> to collect metrics.
        </div>
      </div>
    );
  }

  const rows: { label: string; window: UsageWindow | null }[] = [
    { label: "5h", window: snapshot.five_hour },
    { label: "7d", window: snapshot.seven_day },
    { label: "Sonnet 7d", window: snapshot.seven_day_sonnet },
  ];

  return (
    <Link
      href="/usage"
      style={{
        display: "block",
        padding: "10px 16px 12px",
        borderTop: "1px solid var(--af-border-subtle)",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 10,
          fontWeight: 600,
          color: "var(--af-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 8,
        }}
      >
        <span>Current usage</span>
        <span
          suppressHydrationWarning
          style={{
            fontWeight: 500,
            textTransform: "none",
            letterSpacing: 0,
          }}
        >
          {formatRelative(snapshot.captured_at)}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((r) => (
          <UsageRow key={r.label} {...r} />
        ))}
      </div>
    </Link>
  );
}

function UsageRow({ label, window }: { label: string; window: UsageWindow | null }) {
  const pct = window?.utilization ?? null;
  const hasData = pct !== null;
  const clamped = hasData ? Math.max(0, Math.min(100, pct!)) : 0;
  const toneVar =
    clamped >= 90
      ? "var(--af-danger)"
      : clamped >= 70
        ? "var(--af-warning)"
        : "var(--af-success)";

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          color: "var(--af-text-secondary)",
          marginBottom: 2,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>{label}</span>
        <span style={{ fontWeight: 600, color: "var(--af-text)" }}>
          {hasData ? `${clamped.toFixed(0)}%` : "—"}
        </span>
      </div>
      <div
        style={{
          height: 4,
          background: "var(--af-border-subtle)",
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: hasData ? `${clamped}%` : "0%",
            background: toneVar,
            borderRadius: 999,
            transition: "width 0.24s ease",
          }}
        />
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

"use client";

import Link from "next/link";
import type { UsageSnapshot, UsageWindow } from "@/lib/usage-data";
import { usePersistentBoolean } from "@/lib/use-persistent-boolean";

/**
 * Compact current-usage widget for the sidebar. Always visible on every page.
 * Shows the latest snapshot's 5h and 7d utilization with thin progress bars.
 * The Sonnet row mirrors the same show/hide preference as the main page's
 * OptionalChart — toggled via the `cclens:usage:show-sonnet` key.
 *
 * For full history and leadership metrics, click through to /usage.
 */
export function UsageSidebar({ snapshot }: { snapshot: UsageSnapshot | null }) {
  const [showSonnet, , sonnetHydrated] = usePersistentBoolean(
    "cclens:usage:show-sonnet",
    false,
  );
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
  ];
  // Only include Sonnet after hydration to avoid a layout flash where
  // the SSR pass renders it, then the client removes it on hydrate.
  if (sonnetHydrated && showSonnet) {
    rows.push({ label: "Sonnet 7d", window: snapshot.seven_day_sonnet });
  }

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
          alignItems: "baseline",
          gap: 6,
          fontSize: 10,
          color: "var(--af-text-secondary)",
          marginBottom: 2,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>{label}</span>
        {window?.resets_at && (
          <span
            suppressHydrationWarning
            style={{
              fontSize: 9,
              color: "var(--af-text-tertiary)",
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            resets {formatResetTime(window.resets_at)}
          </span>
        )}
        <span style={{ fontWeight: 600, color: "var(--af-text)", marginLeft: "auto" }}>
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

function formatResetTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((then - now) / 1000);
  const abs = Math.abs(diffSec);
  const past = diffSec < 0;

  let value: string;
  if (abs < 60) {
    value = `${abs}s`;
  } else if (abs < 3600) {
    value = `${Math.floor(abs / 60)}m`;
  } else if (abs < 86400) {
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    value = m > 0 ? `${h}h${m}m` : `${h}h`;
  } else {
    const d = Math.floor(abs / 86400);
    const h = Math.floor((abs % 86400) / 3600);
    value = h > 0 ? `${d}d${h}h` : `${d}d`;
  }

  return past ? `${value} ago` : `in ${value}`;
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

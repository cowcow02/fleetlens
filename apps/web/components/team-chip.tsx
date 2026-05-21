"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatRelative } from "@/lib/format";
import type { TeamConnection } from "@/lib/team-data";
import { deriveHealth, type Health } from "@/lib/team-health";

const COLORS: Record<Health, string> = {
  green: "var(--af-success, #10b981)",
  amber: "var(--af-warning, #f59e0b)",
  red: "var(--af-error, #ef4444)",
};

// Re-derive health every 30s so the dot ages from green → amber → red
// even when no daemon push fires (e.g. daemon stopped, dashboard tab idle).
// The relative-time label gets the same tick for free.
const TICK_MS = 30_000;

export function TeamChip({ connection }: { connection: TeamConnection }) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!connection.paired) return;
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [connection.paired]);

  if (!connection.paired) return null;

  const { team, lastPush } = connection;
  const health = deriveHealth(lastPush, nowMs);
  const dotColor = COLORS[health];

  let timeLabel: string;
  let absoluteTime: string;
  if (lastPush.kind === "none") {
    timeLabel = "waiting…";
    absoluteTime = "Daemon pushes every 5 minutes";
  } else if (lastPush.kind === "error") {
    timeLabel = `failed ${formatRelative(lastPush.at)}`;
    absoluteTime = new Date(lastPush.at).toLocaleString();
  } else {
    timeLabel = `synced ${formatRelative(lastPush.at)}`;
    absoluteTime = new Date(lastPush.at).toLocaleString();
  }

  const tooltipParts = [
    `Team: ${team.name}`,
    absoluteTime,
    lastPush.kind === "error" ? `Error: ${lastPush.error}` : "Click to inspect what's synced.",
  ];

  return (
    <Link
      href="/settings#team"
      title={tooltipParts.join("\n")}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 16px 8px 20px",
        borderTop: "1px solid var(--af-border-subtle)",
        fontSize: 11,
        color: "var(--af-text-secondary)",
        textDecoration: "none",
        minWidth: 0,
      }}
    >
      <span
        aria-hidden
        suppressHydrationWarning
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: dotColor,
          flexShrink: 0,
          boxShadow: `0 0 0 2px color-mix(in srgb, ${dotColor} 25%, transparent)`,
        }}
      />
      <span style={{ flexShrink: 0, fontWeight: 500 }}>Team:</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {team.name}
      </span>
      <span
        style={{
          fontSize: 10,
          color: "var(--af-text-tertiary)",
          fontFamily: "var(--font-mono)",
          flexShrink: 0,
        }}
        suppressHydrationWarning
      >
        {timeLabel}
      </span>
    </Link>
  );
}

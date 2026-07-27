"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type AgentKind,
  getAgentMetadata,
  isAgentKind,
} from "@claude-lens/parser";
import type { UsageSnapshot, UsageWindow } from "@/lib/usage-data";
import {
  sidebarUsageRows,
  sortUsageAgents,
} from "@/lib/usage-display";
import { usePersistentBoolean } from "@/lib/use-persistent-boolean";
import { paceToneForCycle, toneVar } from "@/lib/utilization-tone";

const AGENT_KEY = "cclens:usage:sidebar-agent";

/**
 * Compact current-usage widget for the sidebar. Always visible on every page.
 * Agent tabs pick which provider's latest snapshot to show (persisted). The
 * Sonnet row mirrors the main page's OptionalChart preference via
 * `cclens:usage:show-sonnet`. Click through to /usage?agent=… for history.
 */
export function UsageSidebar({
  latestByAgent,
}: {
  latestByAgent: Partial<Record<AgentKind, UsageSnapshot>>;
}) {
  const agents = useMemo(() => {
    const keys = Object.keys(latestByAgent).filter(isAgentKind) as AgentKind[];
    // Always offer Claude as the empty-state default, matching /usage.
    if (!keys.includes("claude-code")) keys.push("claude-code");
    return sortUsageAgents(keys);
  }, [latestByAgent]);

  const [selected, setSelected, agentHydrated] = usePersistentAgent(
    AGENT_KEY,
    "claude-code",
    agents,
  );
  const [showSonnet, , sonnetHydrated] = usePersistentBoolean(
    "cclens:usage:show-sonnet",
    false,
  );

  const snapshot = latestByAgent[selected] ?? null;
  const showPicker = agents.length > 1;

  if (agents.length === 1 && !snapshot) {
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
        <div
          style={{
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontWeight: 600,
            marginBottom: 4,
          }}
        >
          Usage
        </div>
        <div>
          Run{" "}
          <code style={{ fontFamily: "var(--font-mono)" }}>
            fleetlens daemon start
          </code>{" "}
          to collect metrics.
        </div>
      </div>
    );
  }

  const rows = sidebarUsageRows(selected, snapshot, {
    showSonnet:
      selected === "claude-code" && sonnetHydrated && showSonnet,
  });

  return (
    <div
      style={{
        padding: "10px 16px 12px",
        borderTop: "1px solid var(--af-border-subtle)",
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
          marginBottom: showPicker ? 6 : 8,
        }}
      >
        <span>Current usage</span>
        {snapshot && (
          <Link
            href={`/usage?agent=${selected}`}
            style={{
              fontWeight: 500,
              textTransform: "none",
              letterSpacing: 0,
              color: "var(--af-text-tertiary)",
              textDecoration: "none",
            }}
            suppressHydrationWarning
          >
            {formatRelative(snapshot.captured_at)}
          </Link>
        )}
      </div>

      {showPicker && agentHydrated && (
        <div
          role="tablist"
          aria-label="Usage agent"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 3,
            marginBottom: 8,
          }}
        >
          {agents.map((kind) => {
            const meta = getAgentMetadata(kind);
            const isActive = kind === selected;
            const hasData = !!latestByAgent[kind];
            return (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={isActive}
                disabled={!hasData && kind !== "claude-code"}
                onClick={() => setSelected(kind)}
                title={meta?.displayName ?? kind}
                style={{
                  appearance: "none",
                  border: "none",
                  cursor: hasData || kind === "claude-code" ? "pointer" : "default",
                  padding: "2px 7px",
                  borderRadius: 999,
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                  lineHeight: 1.4,
                  color: isActive
                    ? "var(--af-text)"
                    : hasData
                      ? "var(--af-text-tertiary)"
                      : "var(--af-text-tertiary)",
                  opacity: hasData || kind === "claude-code" ? 1 : 0.45,
                  background: isActive
                    ? "var(--af-border-subtle)"
                    : "transparent",
                  boxShadow: isActive
                    ? `inset 0 0 0 1px ${meta?.accentColor ?? "var(--af-border)"}`
                    : "none",
                }}
              >
                {meta?.shortLabel ?? kind}
              </button>
            );
          })}
        </div>
      )}

      {!snapshot ? (
        <div style={{ fontSize: 10, color: "var(--af-text-tertiary)", lineHeight: 1.4 }}>
          No {getAgentMetadata(selected)?.shortLabel ?? selected} snapshots yet.
        </div>
      ) : (
        <Link
          href={`/usage?agent=${selected}`}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            textDecoration: "none",
            color: "inherit",
          }}
        >
          {rows.map((r) => (
            <UsageRow key={r.label} {...r} />
          ))}
        </Link>
      )}
    </div>
  );
}

/**
 * Persist a selected AgentKind. Falls back to default when the stored value
 * is missing or no longer in the available set (e.g. agent purged from log).
 */
function usePersistentAgent(
  key: string,
  defaultValue: AgentKind,
  available: AgentKind[],
): [AgentKind, (next: AgentKind) => void, boolean] {
  const [value, setValue] = useState<AgentKind>(defaultValue);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let stored: AgentKind | null = null;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw && isAgentKind(raw)) stored = raw;
    } catch {
      // localStorage blocked
    }
    if (stored && available.includes(stored)) setValue(stored);
    else if (available.includes(defaultValue)) setValue(defaultValue);
    else if (available[0]) setValue(available[0]);
    setHydrated(true);
  }, [key, defaultValue, available]);

  // If available agents change after hydration and selection is gone, fall back.
  useEffect(() => {
    if (!hydrated) return;
    if (available.includes(value)) return;
    if (available.includes(defaultValue)) setValue(defaultValue);
    else if (available[0]) setValue(available[0]);
  }, [available, value, defaultValue, hydrated]);

  const update = useCallback(
    (next: AgentKind) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // ignore
      }
    },
    [key],
  );

  return [value, update, hydrated];
}

function UsageRow({
  label,
  window,
  windowMs,
}: {
  label: string;
  window: UsageWindow | null;
  windowMs: number;
}) {
  const pct = window?.utilization ?? null;
  const hasData = pct !== null;
  const clamped = hasData ? Math.max(0, Math.min(100, pct!)) : 0;
  const cycleEndMs = window?.resets_at ? new Date(window.resets_at).getTime() : null;
  const fillColor =
    hasData && cycleEndMs
      ? toneVar(paceToneForCycle(clamped, cycleEndMs, windowMs))
      : "var(--af-border-subtle)";

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
            background: fillColor,
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

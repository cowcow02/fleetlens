"use client";

/**
 * Floating live-sessions widget. Pinned to the bottom-right corner of
 * every page. Shows currently-live sessions (file mtime within 45s)
 * as a stack of compact cards that expand above a small pill. Hidden
 * on session detail pages since the session view itself is already a
 * live UI.
 *
 * Data flows from the root layout: `listSessions` runs per request,
 * and LiveRefresher triggers router.refresh() whenever SSE fires, so
 * the widget stays fresh without its own polling.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { prettyProjectName } from "@/lib/format";

const LIVE_WINDOW_MS = 45_000;
const MAX_VISIBLE = 5;
const EXPANDED_STORAGE_KEY = "cclens-live-widget-expanded";

export type LiveSessionPick = {
  id: string;
  projectName: string;
  firstUserPreview?: string;
  lastUserPreview?: string;
  lastAgentPreview?: string;
  firstTimestamp?: string;
  lastTimestamp?: string;
};

export function LiveSessionsWidget({ sessions }: { sessions: LiveSessionPick[] }) {
  const pathname = usePathname();
  const [now, setNow] = useState(() => Date.now());
  // Collapsed by default on first render so users who previously
  // collapsed it don't see a flash of the expanded card stack before
  // localStorage resolves. First-time users see only the pill; one
  // click expands the card list.
  const [expanded, setExpandedState] = useState(false);

  const setExpanded = (v: boolean | ((prev: boolean) => boolean)) => {
    setExpandedState((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      try {
        localStorage.setItem(EXPANDED_STORAGE_KEY, String(next));
      } catch {
        // Quota exceeded or storage disabled — ignore, in-memory state
        // still works for the rest of the session.
      }
      return next;
    });
  };

  // Sync from localStorage once on mount.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(EXPANDED_STORAGE_KEY);
      if (saved !== null) setExpandedState(saved === "true");
    } catch {
      // Ignore.
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  // Hide on session detail pages — pattern: /sessions/<id>
  if (pathname && /^\/sessions\/[^/]+$/.test(pathname)) return null;

  // Filter to live window, then sort by start time (firstTimestamp)
  // DESCENDING so the newest-started session sits at the top and row
  // order is stable even as agents keep emitting new messages.
  const live = sessions
    .filter((s) => {
      if (!s.lastTimestamp) return false;
      const ms = Date.parse(s.lastTimestamp);
      if (Number.isNaN(ms)) return false;
      return now - ms <= LIVE_WINDOW_MS;
    })
    .slice()
    .sort((a, b) => {
      const aMs = a.firstTimestamp ? Date.parse(a.firstTimestamp) : 0;
      const bMs = b.firstTimestamp ? Date.parse(b.firstTimestamp) : 0;
      return bMs - aMs;
    });

  if (live.length === 0) return null;

  const visible = expanded ? live.slice(0, MAX_VISIBLE) : [];
  const hiddenCount = expanded ? live.length - visible.length : 0;

  return (
    <div
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        zIndex: 100,
        display: "flex",
        // Column-reverse keeps the pill anchored to the bottom and cards
        // stack upward as they expand — the click target never moves.
        flexDirection: "column-reverse",
        gap: 6,
        maxWidth: 320,
        pointerEvents: "auto",
      }}
    >
      {/* Pill — always visible, anchors to bottom-right corner. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 11px 5px 9px",
          background: "rgba(239, 68, 68, 0.14)",
          border: "1px solid rgba(239, 68, 68, 0.4)",
          borderRadius: 100,
          fontSize: 10,
          fontWeight: 700,
          color: "#ef4444",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          alignSelf: "flex-end",
          cursor: "pointer",
          userSelect: "none",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          boxShadow: "0 2px 10px rgba(239, 68, 68, 0.15)",
        }}
        title={expanded ? "Collapse" : `Show ${live.length} live session${live.length === 1 ? "" : "s"}`}
      >
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#ef4444",
            animation: "cs-live-pulse 1.6s ease-in-out infinite",
          }}
        />
        Live · {live.length}
      </button>

      {/* Overflow hint — only when expanded and not all live shown. */}
      {expanded && hiddenCount > 0 && (
        <div
          style={{
            fontSize: 10,
            color: "var(--af-text-tertiary)",
            padding: "0 4px",
            textAlign: "right",
          }}
        >
          +{hiddenCount} more live
        </div>
      )}

      {/* Session cards — reverse order so newest is nearest the pill. */}
      {visible.map((s) => (
        <Link
          key={s.id}
          href={`/sessions/${s.id}`}
          style={{
            display: "block",
            padding: "10px 12px",
            background: "var(--af-surface-elevated)",
            border: "1px solid var(--af-border-subtle)",
            borderLeft: "2px solid #ef4444",
            borderRadius: 8,
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.12)",
            textDecoration: "none",
            color: "var(--af-text)",
            fontSize: 11,
            lineHeight: 1.35,
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
          title={
            (s.lastUserPreview || s.firstUserPreview || s.lastAgentPreview) ??
            prettyProjectName(s.projectName)
          }
        >
          {/* Title: most recent user message — "what am I working on now". */}
          <div
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontWeight: 500,
              color: "var(--af-text)",
            }}
          >
            {s.lastUserPreview || s.firstUserPreview || (
              <em style={{ color: "var(--af-text-tertiary)" }}>(no user message)</em>
            )}
          </div>
          {/* Subtitle: what the agent is saying in response. */}
          <div
            style={{
              fontSize: 10,
              color: "var(--af-text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: 3,
              fontStyle: "italic",
            }}
          >
            {s.lastAgentPreview ? (
              <>↳ {s.lastAgentPreview}</>
            ) : (
              <em style={{ color: "var(--af-text-tertiary)" }}>waiting…</em>
            )}
          </div>
          {/* Bottom line: project name. */}
          <div
            style={{
              fontSize: 9,
              color: "var(--af-text-tertiary)",
              fontFamily: "var(--font-mono)",
              marginTop: 4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {prettyProjectName(s.projectName)}
          </div>
        </Link>
      ))}

      <style>{`
        @keyframes cs-live-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
      `}</style>
    </div>
  );
}

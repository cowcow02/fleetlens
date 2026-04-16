"use client";

import Link from "next/link";
import * as React from "react";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { TimelineData, TeamTrack, TeamTurn, XAnchor, MinimapIdleBand } from "./adapter";
import { xOfMs, msOfXFrac } from "./adapter";

const LANE_HEIGHT = 24;
const LANE_GAP = 2;
const LABEL_WIDTH = 100;
export const DEFAULT_VISIBLE_LANES = 4;

type Props = {
  data: TimelineData;
  playheadMs: number | null;
  onSeek: (tsMs: number, trackId?: string) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Member track ids currently visible in the body table (mid-point inside
   *  the horizontal viewport). When the minimap is collapsed, the lane set
   *  mirrors this — lead first, then whichever members are currently in the
   *  table's viewport. Falls back to "first N members by start time" when
   *  empty, so the initial render is sane. */
  visibleTrackIds: string[];
};

type HoverState = {
  turn: TeamTurn;
  track: TeamTrack;
  clientX: number;
  clientY: number;
};

export function TeamMinimap({
  data,
  playheadMs,
  onSeek,
  expanded,
  onToggleExpanded,
  visibleTrackIds,
}: Props) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const hasOverflow = data.tracks.length > DEFAULT_VISIBLE_LANES;

  // Day-page mode: when the team span exceeds 24h, the adapter pre-computes
  // per-day x-scales and we render one page at a time. The minimap's
  // rangeStart/rangeEnd, xAnchors, and idle bands all come from the active
  // page instead of the global ones.
  const dayPages = data.dayPages ?? null;
  const [pageIndex, setPageIndex] = useState(0);
  // Follow the playhead: if the table scrolls into a different day, advance
  // the minimap page to match so the user's focus stays in view.
  useEffect(() => {
    if (!dayPages || playheadMs == null) return;
    const match = dayPages.findIndex(
      (p) => playheadMs >= p.startMs && playheadMs <= p.endMs,
    );
    if (match !== -1 && match !== pageIndex) setPageIndex(match);
  }, [dayPages, playheadMs, pageIndex]);
  // Clamp pageIndex in case the dataset shrinks between renders.
  const safePageIndex = dayPages
    ? Math.min(Math.max(0, pageIndex), dayPages.length - 1)
    : 0;
  const activePage = dayPages ? dayPages[safePageIndex] : null;

  const activeXAnchors: XAnchor[] = activePage ? activePage.xAnchors : data.xAnchors;
  const activeIdleBands: MinimapIdleBand[] = activePage
    ? activePage.minimapIdleBands
    : data.minimapIdleBands;
  const rangeStartMs = activePage ? activePage.startMs : data.firstEventMs;
  const rangeEndMs = activePage ? activePage.endMs : data.lastEventMs;

  // Compute which tracks are "active" (shown at full height). The minimap
  // always renders every track so CSS transitions can animate lanes in and
  // out when the active set changes; non-active lanes collapse to height 0
  // via transition instead of unmounting.
  //   - expanded → every track active
  //   - collapsed + table has reported visible members → lead + those
  //   - collapsed + no report yet → lead + first N-1 members (initial)
  let activeIds: Set<string>;
  if (expanded || !hasOverflow) {
    activeIds = new Set(data.tracks.map((t) => t.id));
  } else {
    const lead = data.tracks[0];
    const members = data.tracks.slice(1);
    const pickMembers =
      visibleTrackIds.length > 0
        ? members
            .filter((t) => visibleTrackIds.includes(t.id))
            .slice(0, DEFAULT_VISIBLE_LANES - 1)
            .map((t) => t.id)
        : members.slice(0, DEFAULT_VISIBLE_LANES - 1).map((t) => t.id);
    activeIds = new Set(pickMembers);
    if (lead) activeIds.add(lead.id);
  }
  const hiddenCount = data.tracks.length - activeIds.size;

  // Event-anchored x-scale — active intervals stay proportional with a floor,
  // all-idle intervals (including multi-day overnight gaps) collapse into
  // compact bands. Shared across lanes so cross-agent alignment holds.
  // In day-page mode, xOf uses the current page's anchors so each day
  // fills the minimap width instead of sharing a cramped global strip.
  const xOf = (ms: number) => xOfMs(activeXAnchors, ms);

  const onLaneClick = (
    track: TeamTrack,
    e: React.MouseEvent<HTMLDivElement>,
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left);
    const frac = Math.min(1, x / Math.max(1, rect.width));
    onSeek(msOfXFrac(activeXAnchors, frac), track.id);
  };

  // Playhead only renders when it's inside the current page's window.
  const playheadFrac =
    playheadMs != null && playheadMs >= rangeStartMs && playheadMs <= rangeEndMs
      ? Math.max(0, Math.min(1, xOf(playheadMs)))
      : null;

  // Turn bars are clipped to the active page — bars whose entire range is
  // outside the current day window are skipped, bars that straddle the
  // boundary get clamped to the window's edges.
  const clipTurn = (turn: TeamTurn) => {
    if (turn.endMs < rangeStartMs || turn.startMs > rangeEndMs) return null;
    return {
      id: turn.id,
      startMs: Math.max(turn.startMs, rangeStartMs),
      endMs: Math.min(turn.endMs, rangeEndMs),
      original: turn,
    };
  };

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        background: "var(--af-surface-elevated)",
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 6,
        padding: 8,
        marginBottom: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 9,
          color: "var(--af-text-tertiary)",
          fontFamily: "ui-monospace, monospace",
          marginBottom: 6,
          paddingLeft: LABEL_WIDTH,
          gap: 8,
        }}
      >
        <span>{formatEdge(rangeStartMs, data.multiDay)}</span>
        {dayPages && dayPages.length > 1 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 10,
              fontWeight: 600,
              color: "var(--af-text-secondary)",
            }}
          >
            <button
              onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
              disabled={safePageIndex === 0}
              aria-label="Previous day"
              style={pageBtnStyle(safePageIndex === 0)}
            >
              <ChevronLeft size={11} />
            </button>
            <span
              style={{
                minWidth: 64,
                textAlign: "center",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {activePage?.label ?? ""}{" "}
              <span style={{ opacity: 0.55 }}>
                ({safePageIndex + 1}/{dayPages.length})
              </span>
            </span>
            <button
              onClick={() =>
                setPageIndex((i) => Math.min(dayPages.length - 1, i + 1))
              }
              disabled={safePageIndex === dayPages.length - 1}
              aria-label="Next day"
              style={pageBtnStyle(safePageIndex === dayPages.length - 1)}
            >
              <ChevronRight size={11} />
            </button>
          </div>
        )}
        <span>{formatEdge(rangeEndMs, data.multiDay)}</span>
      </div>

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Hatched idle bands spanning all lanes. Positioned as an overlay
            so they line up exactly with the lane strips' x axis (both use
            the shared xOfMs scale). Uses the active page's idle bands in
            day-page mode. */}
        {activeIdleBands.map((band, i) => (
          <IdleBandOverlay key={i} band={band} />
        ))}
        {data.tracks.map((t) => {
          const isActive = activeIds.has(t.id);
          return (
          <div
            key={t.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              // The collapsed lanes animate to zero height with opacity fade
              // so the minimap visually slides when its active set changes
              // (e.g. in response to the table's horizontal scroll or the
              // "Show all" toggle).
              maxHeight: isActive ? LANE_HEIGHT : 0,
              opacity: isActive ? 1 : 0,
              marginBottom: isActive ? LANE_GAP : 0,
              overflow: "hidden",
              transition:
                "max-height 280ms ease, opacity 280ms ease, margin-bottom 280ms ease",
              pointerEvents: isActive ? "auto" : "none",
            }}
          >
            <Link
              href={`/sessions/${t.id}`}
              style={{
                width: LABEL_WIDTH - 6,
                fontSize: 10,
                fontFamily: "ui-monospace, monospace",
                color: t.color,
                fontWeight: t.isLead ? 700 : 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                textDecoration: "none",
              }}
              title={`${t.label} — open session`}
            >
              {t.isLead ? "LEAD" : t.label}
            </Link>
            <div
              style={{
                flex: 1,
                position: "relative",
                height: LANE_HEIGHT,
                background: "var(--af-surface-hover)",
                borderRadius: 3,
                overflow: "hidden",
                cursor: "pointer",
                padding: "3px 2px",
                boxSizing: "border-box",
              }}
              onClick={(e) => onLaneClick(t, e)}
            >
              {t.turns.map((turn) => {
                const clipped = clipTurn(turn);
                if (!clipped) return null;
                const leftFrac = xOf(clipped.startMs);
                const rightFrac = xOf(clipped.endMs);
                const left = leftFrac * 100;
                const width = Math.max(0.4, (rightFrac - leftFrac) * 100);
                return (
                  <div
                    key={turn.id}
                    style={{
                      position: "absolute",
                      left: `calc(${left}% + 1px)`,
                      top: 3,
                      width: `calc(${width}% - 2px)`,
                      minWidth: 4,
                      height: LANE_HEIGHT - 10,
                      background: t.color,
                      opacity: 0.88,
                      borderRadius: 3,
                      border: `1px solid ${t.color}`,
                      boxSizing: "border-box",
                    }}
                    onMouseEnter={(e) =>
                      setHover({
                        turn: clipped.original,
                        track: t,
                        clientX: e.clientX,
                        clientY: e.clientY,
                      })
                    }
                    onMouseMove={(e) =>
                      setHover((h) =>
                        h && h.turn.id === turn.id
                          ? { ...h, clientX: e.clientX, clientY: e.clientY }
                          : h,
                      )
                    }
                    onMouseLeave={() => setHover(null)}
                  />
                );
              })}
              {t.subagents.map((sa, i) => {
                if (sa.startMs == null) return null;
                const saEnd = sa.startMs + (sa.durationMs ?? 0);
                if (saEnd < rangeStartMs || sa.startMs > rangeEndMs) return null;
                const clampedStart = Math.max(sa.startMs, rangeStartMs);
                const clampedEnd = Math.min(saEnd, rangeEndMs);
                const startFrac = xOf(clampedStart);
                const endFrac = xOf(clampedEnd);
                const left = startFrac * 100;
                const w = Math.max(0.2, (endFrac - startFrac) * 100) || 0.4;
                return (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left: `${left}%`,
                      bottom: 2,
                      width: `${w}%`,
                      height: 3,
                      background: t.color,
                      opacity: 0.5,
                      borderRadius: 1,
                    }}
                    title={`subagent: ${sa.agentType}`}
                  />
                );
              })}
            </div>
          </div>
          );
        })}
      </div>

      {hasOverflow && (
        <div
          style={{
            marginTop: 6,
            paddingLeft: LABEL_WIDTH + 6,
            display: "flex",
          }}
        >
          <button
            onClick={onToggleExpanded}
            style={{
              background: "var(--af-surface-hover)",
              border: "1px solid var(--af-border-subtle)",
              color: "var(--af-text-secondary)",
              fontSize: 10,
              fontFamily: "ui-monospace, monospace",
              padding: "2px 8px",
              borderRadius: 10,
              cursor: "pointer",
              lineHeight: 1.4,
            }}
          >
            {expanded
              ? "Show fewer"
              : `+ ${hiddenCount} more agent${hiddenCount === 1 ? "" : "s"} — show all`}
          </button>
        </div>
      )}

      {/* Playhead lives in an overlay that starts AFTER the label column so
          the % coordinate matches the strips exactly. */}
      {playheadFrac != null && (
        <div
          style={{
            position: "absolute",
            top: 24,
            bottom: 8,
            left: LABEL_WIDTH + 6,
            right: 8,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${playheadFrac * 100}%`,
              width: 1,
              background: "var(--af-text)",
              opacity: 0.7,
            }}
          />
        </div>
      )}

      {hover && <HoverCard hover={hover} multiDay={data.multiDay} />}
    </div>
  );
}

function HoverCard({
  hover,
  multiDay,
}: {
  hover: HoverState;
  multiDay: boolean;
}) {
  const { turn, track } = hover;
  const summary = turn.megaRow.summary;
  const tmMsg =
    turn.userPrompt && "event" in turn.userPrompt
      ? turn.userPrompt.event.teammateMessage
      : undefined;
  const userLabel = tmMsg ? `FROM ${tmMsg.teammateId}` : "HUMAN";
  const userText = tmMsg
    ? formatTeammatePreview(tmMsg)
    : turn.userPrompt && turn.userPrompt.kind === "user"
      ? (turn.userPrompt.displayPreview ?? turn.userPrompt.event.preview ?? "")
      : "";
  const firstAgent = summary.firstAgentPreview ?? "";
  const finalAgent = summary.finalAgentPreview ?? "";
  const showFinal = finalAgent && finalAgent !== firstAgent;
  const tools = summary.toolNames.slice(0, 4);

  // Position card near the cursor, biased above-and-right to avoid covering
  // the bar itself. Clamp to viewport via simple offsets.
  const left = Math.min(window.innerWidth - 360, hover.clientX + 12);
  const top = Math.max(8, hover.clientY - 12);

  return (
    <div
      style={{
        position: "fixed",
        left,
        top,
        width: 340,
        background: "var(--af-surface)",
        border: "1px solid var(--af-border-subtle)",
        borderLeft: `3px solid ${track.color}`,
        borderRadius: 4,
        padding: "8px 10px",
        fontSize: 10,
        lineHeight: 1.4,
        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        zIndex: 100,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 9,
          fontFamily: "ui-monospace, monospace",
          color: track.color,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 4,
        }}
      >
        <span>{track.isLead ? "LEAD" : track.label}</span>
        <span style={{ color: "var(--af-text-tertiary)", fontWeight: 500 }}>
          {formatEdge(turn.startMs, multiDay)} → {formatEdge(turn.endMs, multiDay)} · {formatDuration(turn.durationMs)}
        </span>
      </div>
      <div
        style={{
          fontSize: 9,
          color: "var(--af-text-tertiary)",
          marginBottom: 6,
        }}
      >
        {summary.agentMessages} msg · {summary.toolCalls} tools
        {summary.errors > 0 ? ` · ${summary.errors} err` : ""}
      </div>
      {userText && (
        <div style={{ marginBottom: 5 }}>
          <div
            style={{
              fontSize: 8,
              color: tmMsg ? "var(--af-text-tertiary)" : track.color,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: 1,
              fontStyle: tmMsg ? "italic" : undefined,
            }}
          >
            {userLabel}
          </div>
          <div
            style={{
              color: tmMsg ? "var(--af-text-tertiary)" : "var(--af-text)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {userText}
          </div>
        </div>
      )}
      {firstAgent && (
        <div style={{ marginBottom: 5 }}>
          <div
            style={{
              fontSize: 8,
              color: track.color,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: 1,
            }}
          >
            AGENT
          </div>
          <div
            style={{
              color: "var(--af-text)",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {firstAgent}
          </div>
        </div>
      )}
      {tools.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 3,
            flexWrap: "wrap",
            marginBottom: showFinal ? 5 : 0,
          }}
        >
          {tools.map((t) => (
            <span
              key={t.name}
              style={{
                fontSize: 8,
                padding: "1px 5px",
                background: "var(--af-surface-hover)",
                borderRadius: 2,
                color: "var(--af-text-tertiary)",
              }}
            >
              {t.name}
              {t.count > 1 ? ` ×${t.count}` : ""}
            </span>
          ))}
        </div>
      )}
      {showFinal && (
        <div>
          <div
            style={{
              fontSize: 8,
              color: track.color,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              marginBottom: 1,
            }}
          >
            RESULT
          </div>
          <div
            style={{
              color: "var(--af-text)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {finalAgent}
          </div>
        </div>
      )}
    </div>
  );
}

function pageBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: "transparent",
    border: "1px solid var(--af-border-subtle)",
    color: disabled ? "var(--af-text-tertiary)" : "var(--af-text-secondary)",
    width: 18,
    height: 18,
    borderRadius: 3,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
    padding: 0,
  };
}

function formatEdge(ms: number, multiDay: boolean): string {
  const d = new Date(ms);
  if (!multiDay) {
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} ${time}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3600_000).toFixed(1)}h`;
}

function IdleBandOverlay({ band }: { band: MinimapIdleBand }) {
  const [hovered, setHovered] = useState(false);
  const left = band.xFracStart * 100;
  const width = Math.max(0.5, (band.xFracEnd - band.xFracStart) * 100);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: `calc(${LABEL_WIDTH}px + ${left}% * (100% - ${LABEL_WIDTH}px) / 100%)`,
        width: `calc(${width}% * (100% - ${LABEL_WIDTH}px) / 100%)`,
        background:
          "repeating-linear-gradient(135deg, transparent 0, transparent 4px, var(--af-border-subtle) 4px, var(--af-border-subtle) 6px)",
        zIndex: 1,
        cursor: "help",
      }}
    >
      {hovered && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: "calc(100% + 6px)",
            transform: "translateX(-50%)",
            background: "#0F172A",
            color: "#F1F5F9",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 11,
            pointerEvents: "none",
            boxShadow: "0 4px 16px rgba(15,23,42,0.22)",
            zIndex: 20,
            whiteSpace: "nowrap",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 1 }}>Idle</div>
          <div style={{ opacity: 0.78, fontFamily: "ui-monospace, monospace", fontSize: 10 }}>
            {band.label}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTeammatePreview(
  tm: NonNullable<import("@claude-lens/parser").SessionEvent["teammateMessage"]>,
): string {
  switch (tm.kind) {
    case "idle-notification":
      return `${tm.teammateId} is idle / available`;
    case "shutdown-request":
      return `${tm.teammateId} requesting shutdown`;
    case "shutdown-approved":
      return `${tm.teammateId} shutdown approved`;
    case "teammate-terminated":
      return `${tm.teammateId} has shut down`;
    case "task-assignment":
      return `task assigned to ${tm.teammateId}`;
    default:
      return tm.body.length > 120 ? tm.body.slice(0, 120) + "…" : tm.body;
  }
}

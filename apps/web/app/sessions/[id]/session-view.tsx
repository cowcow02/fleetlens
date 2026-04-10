"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Cpu,
  Folder,
  Search,
  Wrench,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ContentBlock,
  SessionDetail,
  SessionEvent,
  SubagentRun,
} from "@claude-sessions/parser";
import {
  buildPresentation,
  buildMegaRows,
  rowPrimaryIndex as rowPrimaryIndexFromLib,
  type MegaRow,
  type PresentationRow,
  type PresentationRowKind,
  type TurnMegaRow,
  type TurnSummary,
} from "@claude-sessions/parser";
import { formatGap, formatOffset, formatRelative, formatTokens, shortId } from "@/lib/format";

/* ------------------------------------------------------------------ */
/*  Constants + theming                                               */
/* ------------------------------------------------------------------ */

/** Gap > this (ms) before a user row is shown as a "Session idle" divider. */
const IDLE_THRESHOLD_MS = 2000;

/** Sticky header height (session header + tabs + mini-map).
 *  Transcript rows reserve this as scroll-margin so scrollIntoView lands
 *  them below the sticky area instead of hidden underneath. */
const STICKY_HEADER_HEIGHT = 310;

type RoleTheme = {
  label: string;
  bg: string;
  fg: string;
  mini: string;
};

/**
 * Palette modeled on Claude Managed Agents' Sessions view — muted,
 * desaturated tones that read cleanly against the cream background.
 * `bg`/`fg` drive the in-row pill; `mini` drives the timeline block fill.
 */
const ROLE_THEMES: Record<PresentationRowKind, RoleTheme> = {
  user: {
    label: "User",
    bg: "rgba(201, 112, 112, 0.18)",
    fg: "#8B3A3A",
    mini: "#C97070",
  },
  agent: {
    label: "Agent",
    bg: "rgba(92, 132, 195, 0.18)",
    fg: "#2E4A7A",
    mini: "#5C84C3",
  },
  "tool-group": {
    label: "Tool",
    bg: "rgba(138, 133, 128, 0.16)",
    fg: "#44403C",
    mini: "#8A8580",
  },
  interrupt: {
    label: "Interrupt",
    bg: "rgba(217, 119, 6, 0.14)",
    fg: "#78350F",
    mini: "#D97706",
  },
  model: {
    label: "Model",
    bg: "rgba(168, 85, 247, 0.12)",
    fg: "#581C87",
    mini: "#A855F7",
  },
  error: {
    label: "Error",
    bg: "rgba(197, 48, 48, 0.18)",
    fg: "#8B1818",
    mini: "#C53030",
  },
  "task-notification": {
    label: "Task",
    bg: "rgba(100, 116, 139, 0.12)",
    fg: "#475569",
    mini: "#64748B",
  },
};

type FilterMode = "turns" | "meaningful" | "all" | PresentationRowKind;

const FILTER_MODES: { value: FilterMode; label: string }[] = [
  { value: "turns", label: "Turns" },
  { value: "meaningful", label: "All actions" },
  { value: "all", label: "All events" },
  { value: "user", label: "User only" },
  { value: "agent", label: "Agent only" },
  { value: "tool-group", label: "Tool only" },
  { value: "error", label: "Errors only" },
];

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

/** Drawer width in px — reserved on the transcript's right edge when open. */
const DRAWER_WIDTH = 460;

export function SessionView({ session }: { session: SessionDetail }) {
  const [tab, setTab] = useState<"transcript" | "debug">("transcript");
  const [filter, setFilter] = useState<FilterMode>("turns");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null);
  const [expandedTurns, setExpandedTurns] = useState<Set<number>>(new Set());
  /** When a timeline click sets the index we also want to scroll. Track that
   *  intent separately so selection via row-click doesn't auto-scroll. */
  const [scrollIntent, setScrollIntent] = useState(0);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});

  /** Measured height of the sticky header — used both as the drawer's
   *  top offset (so it sits exactly below the header) and as the
   *  scroll-margin for transcript rows (so click-to-focus lands a row
   *  below the header instead of hidden underneath it). Measured once
   *  at mount + on resize via ResizeObserver — no magic constants. */
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(STICKY_HEADER_HEIGHT);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderH(el.offsetHeight);
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  /** Collapsed-header state. When the user scrolls past the first
   *  ~80px, hide the breadcrumb / title / meta-stats / tabs row and
   *  keep only the mini-map visible. This matches the pattern in
   *  Claude's own Sessions UI — you trade discovery info for more
   *  screen real-estate once you're deep in reading. Hysteresis (60
   *  vs 80) prevents flicker at the boundary. */
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const main = el.closest("main") as HTMLElement | null;
    if (!main) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = main.scrollTop;
      // Expand hysteresis: collapse at >80, expand when back under 30.
      setCollapsed((prev) => (prev ? y > 30 : y > 80));
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(update);
    };
    update();
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      main.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Run after every render that changed scrollIntent — the DOM is now
  // guaranteed up-to-date (including any drawer grid reflow).
  useEffect(() => {
    if (selectedIndex === null) return;
    const el = rowRefs.current[selectedIndex];
    if (!el) return;

    // scrollIntoView correctly handles content-visibility: auto on the
    // target's ancestors/siblings (it forces layout-measure of the row,
    // unlike manual offsetTop math which reads the stale placeholder
    // size of unvisited rows). Use "start" + a scroll-margin-top in CSS
    // to land the row just below the sticky header.
    el.scrollIntoView({ block: "start", behavior: "auto" });
  }, [scrollIntent, selectedIndex]);

  const { events, durationMs, totalUsage, model, eventCount, projectName } = session;

  /** Build the full presentation stream once. */
  const allRows = useMemo(() => buildPresentation(events), [events]);

  /** Collapse the presentation stream into conversational turns (user →
   *  agent loop → next user). Used by the "turns" filter mode. */
  const megaRows = useMemo(() => buildMegaRows(allRows), [allRows]);

  /** Lookup: row primary index → containing turn's primary index.
   *  Used when a mini-map click targets a row inside a collapsed turn —
   *  we auto-expand that turn before scrolling. */
  const turnByRowIndex = useMemo(() => {
    const map = new Map<number, number>();
    for (const m of megaRows) {
      if (m.kind !== "turn") continue;
      for (const r of m.rows) {
        map.set(rowPrimaryIndex(r), m.firstPrimaryIndex);
      }
    }
    return map;
  }, [megaRows]);

  /** Flat list of display items the TranscriptList iterates over.
   *  Three modes:
   *    - "turns"  → megaRows, expanded via expandedTurns set
   *    - "all"    → raw events (debug fallback)
   *    - other    → filtered flat presentation rows
   */
  const displayRows: DisplayRow[] = useMemo(() => {
    if (filter === "turns") {
      return flattenMegaRows(megaRows, expandedTurns);
    }
    if (filter === "all")
      return allRowsAsRawRows(events).map((r) => ({
        kind: "presentation",
        row: r,
      }));
    if (filter === "meaningful") return allRows.map((r) => ({ kind: "presentation", row: r }));
    return allRows
      .filter((r) => {
        if (filter === "agent") return r.kind === "agent";
        if (filter === "tool-group") return r.kind === "tool-group";
        return r.kind === filter;
      })
      .map((r) => ({ kind: "presentation", row: r }));
  }, [filter, megaRows, expandedTurns, allRows, events]);

  const selectedEvent =
    selectedIndex !== null ? (events.find((e) => e.index === selectedIndex) ?? null) : null;
  const selectedRow =
    selectedIndex !== null
      ? (allRows.find((r) => rowPrimaryIndex(r) === selectedIndex) ?? null)
      : null;

  function toggleTurn(firstPrimaryIndex: number) {
    setExpandedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(firstPrimaryIndex)) next.delete(firstPrimaryIndex);
      else next.add(firstPrimaryIndex);
      return next;
    });
  }

  function scrollToIndex(index: number) {
    // If we're in turns mode and the target row is inside a collapsed
    // turn, expand that turn first so the row actually exists in the DOM
    // before the scroll effect runs.
    if (filter === "turns") {
      const turnIdx = turnByRowIndex.get(index);
      if (turnIdx !== undefined && !expandedTurns.has(turnIdx)) {
        setExpandedTurns((prev) => new Set(prev).add(turnIdx));
      }
    }
    setSelectedIndex(index);
    // Bump the intent counter so the useEffect always fires — even if the
    // same row is clicked twice (same selectedIndex ≠ new effect otherwise).
    setScrollIntent((n) => n + 1);
  }

  const totalInput = totalUsage.input + totalUsage.cacheRead + totalUsage.cacheWrite;

  return (
    <div style={{ padding: 0 }}>
      {/* ============================ STICKY HEADER ============================ */}
      <div
        ref={headerRef}
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          background: "var(--background)",
          borderBottom: "1px solid var(--af-border-subtle)",
          padding: "18px 40px 0",
        }}
      >
        {/* Collapsible top block — breadcrumb + title + meta-stats + tabs.
            Hidden once the user scrolls past ~80px so the mini-map alone
            stays pinned and the transcript gets more vertical space. */}
        <div
          style={{
            maxHeight: collapsed ? 0 : 500,
            opacity: collapsed ? 0 : 1,
            overflow: "hidden",
            transition:
              "max-height 0.24s ease, opacity 0.18s ease, margin-bottom 0.24s ease",
            marginBottom: collapsed ? 0 : 0,
            pointerEvents: collapsed ? "none" : "auto",
          }}
        >
        {/* Breadcrumb */}
        <div
          style={{
            fontSize: 12,
            color: "var(--af-text-tertiary)",
            marginBottom: 6,
          }}
        >
          <Link
            href="/sessions"
            style={{
              color: "var(--af-text-tertiary)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <ArrowLeft size={12} /> Sessions
          </Link>
          <span style={{ margin: "0 8px" }}>/</span>
          <span style={{ fontFamily: "var(--font-mono)" }}>sesn_{shortId(session.id)}</span>
        </div>

        {/* Single-line compact header — title + inline dot-separated stats */}
        <div
          className="flex items-baseline"
          style={{
            gap: 10,
            marginBottom: 10,
            flexWrap: "wrap",
          }}
        >
          <h1
            style={{
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              fontFamily: "var(--font-mono)",
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            sesn_{session.id.replace(/-/g, "").slice(0, 22)}
          </h1>
          <span
            style={{
              fontSize: 10.5,
              padding: "2px 9px",
              borderRadius: 100,
              background: "var(--af-border-subtle)",
              color: "var(--af-text-secondary)",
              fontWeight: 500,
              position: "relative",
              top: -1,
            }}
          >
            {session.status === "running" ? "Running" : "Idle"}
          </span>
          <InlineStatDivider />
          {model && <InlineStat icon={<Cpu size={12} />} value={model} mono />}
          <InlineStatDivider />
          <InlineStat icon={<Folder size={12} />} value={projectName} truncate />
          <InlineStatDivider />
          {durationMs !== undefined && (
            <InlineStat icon={<Clock size={12} />} value={formatDurationHeader(durationMs)} />
          )}
          <InlineStatDivider />
          <InlineTokenStat usage={totalUsage} />
          <InlineStatDivider />
          <InlineStat value={`${eventCount} events`} />
          <span style={{ marginLeft: "auto" }}>
            {session.firstTimestamp && (
              <span
                style={{
                  fontSize: 11.5,
                  color: "var(--af-text-tertiary)",
                }}
                suppressHydrationWarning
              >
                {formatRelative(session.firstTimestamp)}
              </span>
            )}
          </span>
        </div>

        {/* Tabs + toolbar */}
        <div
          className="flex items-center"
          style={{
            gap: 14,
            paddingBottom: 8,
          }}
        >
          <div className="af-tabs">
            <button
              className={`af-tab-btn ${tab === "transcript" ? "active" : ""}`}
              onClick={() => setTab("transcript")}
            >
              Transcript
            </button>
            <button
              className={`af-tab-btn ${tab === "debug" ? "active" : ""}`}
              onClick={() => setTab("debug")}
            >
              Debug
            </button>
          </div>

          <div
            style={{
              width: 1,
              height: 20,
              background: "var(--af-border-subtle)",
            }}
          />

          <select
            value={filter}
            onChange={(e) =>
              setFilter(e.target.value as "meaningful" | "all" | PresentationRowKind)
            }
            style={{ height: 32, padding: "4px 12px !important" }}
          >
            {FILTER_MODES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>

          <button
            title="Search"
            style={{
              background: "transparent",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 6,
              padding: 6,
              cursor: "pointer",
              color: "var(--af-text-secondary)",
            }}
          >
            <Search size={14} />
          </button>

          <span
            style={{
              marginLeft: "auto",
              fontSize: 12,
              color: "var(--af-text-tertiary)",
            }}
          >
            {filter === "turns"
              ? `${megaRows.filter((m) => m.kind === "turn").length} turns · ${allRows.length} actions`
              : filter === "meaningful"
                ? `${allRows.length} rows (of ${events.length} raw events)`
                : `${displayRows.length} rows`}
          </span>

          <button
            title="Copy all"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--af-text-secondary)",
              fontSize: 12,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
            onClick={() => {
              const text = allRows.map((r) => `[${r.kind}] ${rowPreview(r)}`).join("\n");
              navigator.clipboard?.writeText(text);
            }}
          >
            <Copy size={12} /> Copy all
          </button>
        </div>
        </div>{/* /collapsible top block */}

        {/* Mini-map — adapts to whatever the transcript list is currently
            showing. In "Turns" mode a collapsed turn becomes ONE wide block
            spanning its duration. In flat modes, each row is atomic. The
            `subagents` prop adds parallel lanes below the main timeline,
            one bar per subagent run, positioned at the same x-scale.
            This strip stays visible even when the header is collapsed. */}
        <div
          style={{
            paddingBottom: collapsed ? 10 : 0,
            transition: "padding-bottom 0.2s ease",
          }}
        >
        <Minimap
          displayRows={displayRows}
          durationMs={durationMs ?? 0}
          selectedIndex={selectedIndex}
          onSelect={scrollToIndex}
          headerOffset={headerH}
          subagents={session.subagents}
          selectedSubagentId={selectedSubagentId}
          onSelectSubagent={(id) => {
            setSelectedSubagentId(id);
            // Close the event drawer so we don't have two drawers fighting
            // for the same right-side real estate.
            if (id) setSelectedIndex(null);
          }}
        />
        </div>
      </div>

      {/* ============================ CONTENT ============================ */}
      {/* Transcript is in normal flow; when the drawer is open we reserve
          DRAWER_WIDTH on the right so rows don't slide under it. */}
      <div
        style={{
          padding: "0 40px",
          paddingRight: selectedEvent ? DRAWER_WIDTH + 24 : 40,
          paddingTop: 8,
          transition: "padding-right 0.15s ease",
        }}
      >
        {tab === "transcript" ? (
          <TranscriptList
            displayRows={displayRows}
            rowRefs={rowRefs}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            onToggleTurn={toggleTurn}
            stickyOffset={headerH + 16}
          />
        ) : (
          <DebugList events={events} />
        )}
      </div>

      {/* Drawer — position: fixed, anchored to the viewport so it's
          independent of the main scroll container, grid cells, or any
          calc() height math. Top is measured from the sticky header via
          ResizeObserver so it tracks header size changes automatically. */}
      {selectedEvent && (
        <aside
          style={{
            position: "fixed",
            top: headerH,
            right: 0,
            bottom: 0,
            width: DRAWER_WIDTH,
            borderLeft: "1px solid var(--af-border-subtle)",
            background: "var(--af-surface)",
            overflowY: "auto",
            zIndex: 25,
            boxShadow: "-8px 0 24px rgba(15, 23, 42, 0.05)",
          }}
        >
          <Drawer event={selectedEvent} row={selectedRow} onClose={() => setSelectedIndex(null)} />
        </aside>
      )}

      {/* Sub-agent detail drawer — opens when the user clicks a lane
          bar on the mini-map. Shows the full prompt the parent sent,
          timing + token breakdown, tool call counts, and the final
          agent text. Clicking "Jump to parent" scrolls the transcript
          to the Agent tool_use row that dispatched this subagent. */}
      {(() => {
        const sub = selectedSubagentId
          ? session.subagents?.find((s) => s.agentId === selectedSubagentId)
          : undefined;
        if (!sub) return null;
        return (
          <aside
            style={{
              position: "fixed",
              top: headerH,
              right: 0,
              bottom: 0,
              width: DRAWER_WIDTH,
              borderLeft: "1px solid var(--af-border-subtle)",
              background: "var(--af-surface)",
              overflowY: "auto",
              zIndex: 26,
              boxShadow: "-8px 0 24px rgba(15, 23, 42, 0.08)",
            }}
          >
            <SubagentDrawer
              subagent={sub}
              onClose={() => setSelectedSubagentId(null)}
              onJumpToParent={() => {
                // Find the parent Agent tool-call row by its toolUseId and
                // scroll the transcript to it.
                if (!sub.parentToolUseId) return;
                const parentEvent = events.find((e) =>
                  e.blocks.some(
                    (b) =>
                      b?.type === "tool_use" &&
                      b.name === "Agent" &&
                      b.id === sub.parentToolUseId,
                  ),
                );
                if (parentEvent) {
                  setSelectedSubagentId(null);
                  scrollToIndex(parentEvent.index);
                }
              }}
            />
          </aside>
        );
      })()}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Row helpers                                                       */
/* ------------------------------------------------------------------ */

const rowPrimaryIndex = rowPrimaryIndexFromLib;

/* ------------------------------------------------------------------ */
/*  DisplayRow: one line in the transcript list                      */
/*                                                                     */
/*  Flat list item type — either a presentation row (user, agent,    */
/*  tool-group, error, ...), a collapsed turn summary, or an         */
/*  expanded-turn header with its inner rows following.              */
/* ------------------------------------------------------------------ */

type DisplayRow =
  | { kind: "presentation"; row: PresentationRow; indented?: boolean }
  | { kind: "turn-collapsed"; turn: TurnMegaRow }
  | { kind: "turn-expanded-header"; turn: TurnMegaRow }
  | { kind: "turn-expanded-footer"; turn: TurnMegaRow };

function flattenMegaRows(megaRows: MegaRow[], expanded: Set<number>): DisplayRow[] {
  const out: DisplayRow[] = [];
  for (const m of megaRows) {
    if (m.kind === "turn") {
      if (expanded.has(m.firstPrimaryIndex)) {
        out.push({ kind: "turn-expanded-header", turn: m });
        for (const r of m.rows) {
          out.push({ kind: "presentation", row: r, indented: true });
        }
        out.push({ kind: "turn-expanded-footer", turn: m });
      } else {
        out.push({ kind: "turn-collapsed", turn: m });
      }
    } else {
      out.push({ kind: "presentation", row: m });
    }
  }
  return out;
}

function rowPreview(r: PresentationRow): string {
  switch (r.kind) {
    case "user":
      return r.displayPreview ?? r.event.preview;
    case "agent":
      return r.event.preview;
    case "tool-group":
      return formatToolSummary(r.toolNames);
    case "interrupt":
      return "Interrupted";
    case "model":
      return tokenSummaryLine(r.event.usage);
    case "error":
      return r.message;
    case "task-notification": {
      const icon =
        r.status === "success"
          ? "✓"
          : r.status === "failed"
            ? "✗"
            : r.status === "running"
              ? "…"
              : "•";
      return `${icon} ${r.summary}`;
    }
  }
}

/** Render a compact "Bash ×3 · Read ×2 · Grep · Edit" style summary.
 *  Truncates after 4 unique tools with "+N more". */
function formatToolSummary(toolNames: { name: string; count: number }[]): string {
  const MAX = 4;
  const shown = toolNames.slice(0, MAX);
  const overflow = toolNames.length - MAX;
  const parts = shown.map((t) => {
    const display = shortenToolName(t.name);
    return t.count > 1 ? `${display} ×${t.count}` : display;
  });
  if (overflow > 0) parts.push(`+${overflow} more`);
  return parts.join(" · ");
}

function tokenSummaryLine(u: SessionEvent["usage"]): string {
  if (!u) return "0 input · 0 output · 0 cache read · 0 cache write";
  return `${u.input} input · ${u.output} output · ${u.cacheRead} cache read · ${u.cacheWrite} cache write`;
}

/** Fallback for "All events" filter mode — wraps each raw event in a
 *  synthetic PresentationRow so the transcript component can render
 *  everything (attachments, meta, thinking, tool_result) without
 *  going through the meaningful-transformation logic. */
function allRowsAsRawRows(events: SessionEvent[]): PresentationRow[] {
  const out: PresentationRow[] = [];
  for (const e of events) {
    // Coerce every raw event to the closest presentation kind.
    let kind: PresentationRowKind;
    switch (e.role) {
      case "user":
        kind = "user";
        break;
      case "agent":
      case "agent-thinking":
        kind = "agent";
        break;
      case "tool-call":
      case "tool-result":
        kind = "tool-group";
        break;
      case "system":
      case "meta":
        kind = "model";
        break;
    }
    if (kind === "tool-group") {
      out.push({
        kind: "tool-group",
        toolNames: [{ name: e.toolName ?? e.rawType, count: 1 }],
        count: 1,
        events: [e],
        tOffsetMs: e.tOffsetMs,
        gapMs: e.gapMs,
      });
    } else if (kind === "agent") {
      out.push({
        kind: "agent",
        event: e,
        groupedEvents: [e],
        tOffsetMs: e.tOffsetMs,
        gapMs: e.gapMs,
      });
    } else if (kind === "user") {
      out.push({
        kind: "user",
        event: e,
        tOffsetMs: e.tOffsetMs,
        gapMs: e.gapMs,
      });
    } else {
      out.push({
        kind: "model",
        event: e,
        tOffsetMs: e.tOffsetMs,
        gapMs: e.gapMs,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Header stats + token stat w/ tooltip                              */
/* ------------------------------------------------------------------ */

/** Compact inline header stat — icon + value, separated by dots.
 *  Used in the single-line session header, modeled on Claude's Sessions page. */
function InlineStat({
  icon,
  value,
  mono,
  truncate,
}: {
  icon?: React.ReactNode;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 12,
        color: "var(--af-text-secondary)",
        maxWidth: truncate ? 260 : undefined,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {icon && (
        <span
          style={{
            display: "inline-flex",
            color: "var(--af-text-tertiary)",
          }}
        >
          {icon}
        </span>
      )}
      <span
        style={{
          fontFamily: mono ? "var(--font-mono)" : "inherit",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </span>
  );
}

function InlineStatDivider() {
  return (
    <span
      style={{
        color: "var(--af-text-tertiary)",
        fontSize: 11,
        opacity: 0.6,
      }}
    >
      ·
    </span>
  );
}

function InlineTokenStat({ usage }: { usage: SessionEvent["usage"] }) {
  const [hover, setHover] = useState(false);
  const u = usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const totalIn = u.input + u.cacheRead + u.cacheWrite;
  const pctRead = totalIn > 0 ? Math.round((u.cacheRead / totalIn) * 100) : 0;
  const cached = u.cacheRead + u.cacheWrite;

  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        color: "var(--af-text-secondary)",
        cursor: "default",
        fontFamily: "var(--font-mono)",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Primary: fresh input / output. This is the actually-new
          per-request context — distinct from the cached context that
          dominates most agentic sessions (often 99%+). */}
      <span>
        {formatTokens(u.input)}
        <span style={{ color: "var(--af-text-tertiary)", margin: "0 3px" }}>in</span>
        {formatTokens(u.output)}
        <span style={{ color: "var(--af-text-tertiary)", marginLeft: 3 }}>out</span>
      </span>
      {/* Secondary: cached context as a separate hint so the header
          doesn't lump 50M+ cache hits into the "tokens" number. */}
      {cached > 0 && (
        <span
          style={{
            fontSize: 10.5,
            color: "var(--af-text-tertiary)",
            paddingLeft: 6,
            borderLeft: "1px solid var(--af-border-subtle)",
          }}
        >
          +{formatTokens(cached)} cached
        </span>
      )}
      {hover && (
        <Tooltip
          style={{
            top: "calc(100% + 6px)",
            left: 0,
            minWidth: 240,
          }}
        >
          <TooltipRow label="Input (fresh)" value={u.input.toLocaleString()} />
          <TooltipRow label="Output" value={u.output.toLocaleString()} />
          <TooltipRow label="Cache read" value={`${u.cacheRead.toLocaleString()} (${pctRead}%)`} />
          <TooltipRow label="Cache write" value={u.cacheWrite.toLocaleString()} />
          <div
            style={{
              marginTop: 6,
              paddingTop: 6,
              borderTop: "1px solid rgba(241,245,249,0.12)",
              opacity: 0.65,
              fontSize: 10,
              whiteSpace: "normal",
              lineHeight: 1.4,
            }}
          >
            Cache reads are cumulative across all API requests and billed at ~10% of regular input.
          </div>
        </Tooltip>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Generic Tooltip                                                    */
/* ------------------------------------------------------------------ */

function Tooltip({ children, style }: { children: React.ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        zIndex: 100,
        background: "#1A1A1A",
        color: "#F5F1EC",
        borderRadius: 8,
        padding: "10px 12px",
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        lineHeight: 1.5,
        boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
        pointerEvents: "none",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mini-map                                                           */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Mini-map                                                           */
/*                                                                     */
/*  Design:                                                            */
/*  - Renders ONE segment per presentation row (not per raw event)     */
/*    so density matches what the user sees in the transcript.         */
/*  - Variable heights by importance: User/Agent/Error/Interrupt       */
/*    full height; Tool/Model reduced; idle = full w/ stripes.         */
/*  - Minimum block width 5px so single events never disappear.        */
/*  - Scroll playhead: thin vertical line tracks the current transcript*/
/*    scroll position inside the <main> container.                     */
/*  - Time axis ticks below the bar, auto-scaled by total duration.    */
/*  - Rich hover card (role pill + preview) instead of bare SVG title. */
/* ------------------------------------------------------------------ */

type MinimapSeg =
  | {
      kind: "row";
      row: PresentationRow;
      primaryIndex: number;
      start: number;
      end: number;
    }
  | {
      kind: "turn";
      turn: TurnMegaRow;
      primaryIndex: number;
      start: number;
      end: number;
    }
  | { kind: "idle"; start: number; end: number; durationMs: number };

/** All rows render at full bar height — distinction comes from color/pattern
 *  alone, matching Claude Managed Agents' unified-height timeline. */
const ROW_IMPORTANCE: Record<PresentationRowKind, number> = {
  user: 1.0,
  agent: 1.0,
  interrupt: 1.0,
  error: 1.0,
  "tool-group": 1.0,
  model: 1.0,
  "task-notification": 1.0,
};

function Minimap({
  displayRows,
  durationMs,
  selectedIndex,
  onSelect,
  headerOffset,
  subagents,
  selectedSubagentId,
  onSelectSubagent,
}: {
  displayRows: DisplayRow[];
  durationMs: number;
  selectedIndex: number | null;
  onSelect: (i: number) => void;
  headerOffset: number;
  subagents?: SubagentRun[];
  selectedSubagentId?: string | null;
  onSelectSubagent?: (id: string | null) => void;
}) {
  const WIDTH = 1400;
  /** Main timeline height. Sub-agent lanes stack below this. */
  const MAIN_H = 28;
  /** Per-subagent lane height including the inner gap. */
  const SUB_LANE_H = 11;
  /** Gap between the main timeline and the sub-agent lanes (when present). */
  const SUB_LANE_GAP = 6;
  const BAR_TOP = 3;
  const BAR_BOT = MAIN_H - 3;
  const BAR_H = BAR_BOT - BAR_TOP;
  /** Gap subtracted from each segment's width so blocks never touch. */
  const GAP = 3;
  const MIN_BLOCK = 6;
  /** Minimum displayed segment width in SVG units. Every segment gets at
   *  least this much space regardless of time duration, so tool-group
   *  blocks inside a 24-minute session are still visible + clickable. */
  const MIN_DISPLAY_WIDTH = 12;
  /** Error/interrupt rendered as thin vertical bars capped at this width. */
  const THIN_BAR_MAX = 5;

  const [hover, setHover] = useState<{
    clientX: number;
    row?: PresentationRow;
    turn?: TurnMegaRow;
    idleMs?: number;
    subagent?: SubagentRun;
  } | null>(null);
  const [playheadMs, setPlayheadMs] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /* Playhead — track which transcript row is at the top of the viewport.
   *
   * The old implementation ran `querySelectorAll("[data-sl-row-index]")`
   * on every scroll event. For a session with ~2000 rows that's thousands
   * of DOM queries per second during scroll — enough to pin a CPU core
   * and make Chrome ask to kill the tab. IntersectionObserver is event-
   * driven: the browser only notifies us when rows cross a narrow band
   * near the top of the viewport (the "playhead line"), so the cost
   * scales with *changes* instead of with scroll rate × row count.
   */
  useEffect(() => {
    const main = containerRef.current?.closest("main") as HTMLElement | null;
    if (!main) return;

    // A thin horizontal band just below the sticky header. A row is
    // "at the playhead" when it enters this band from the bottom.
    // rootMargin: top crop = headerOffset (so the band starts where the
    // transcript actually starts), bottom crop = everything except the
    // band, so only rows inside the band trigger callbacks.
    const BAND_HEIGHT = 12;
    const rootMargin = `-${headerOffset}px 0px -${Math.max(
      0,
      main.clientHeight - headerOffset - BAND_HEIGHT,
    )}px 0px`;

    // Track which rows are currently inside the band. The topmost is
    // the playhead. Using a Set keeps updates O(1).
    const inBand = new Set<HTMLElement>();

    const publishTopmost = () => {
      if (inBand.size === 0) {
        // Fall back to the row just above the band by scanning the
        // few immediately-adjacent rows — cheap because the band is
        // narrow.
        setPlayheadMs(null);
        return;
      }
      let topmost: HTMLElement | null = null;
      let topmostOff = Infinity;
      for (const el of inBand) {
        const t = el.offsetTop;
        if (t < topmostOff) {
          topmostOff = t;
          topmost = el;
        }
      }
      if (!topmost) {
        setPlayheadMs(null);
        return;
      }
      const tOff = Number(topmost.getAttribute("data-sl-toffset"));
      setPlayheadMs(Number.isNaN(tOff) ? null : tOff);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          if (e.isIntersecting) inBand.add(el);
          else inBand.delete(el);
        }
        publishTopmost();
      },
      { root: main, rootMargin, threshold: 0 },
    );

    // Observe all current rows. Re-observes whenever the row count
    // changes (i.e. filter switch, turn expand/collapse).
    const rows = main.querySelectorAll<HTMLDivElement>("[data-sl-row-index]");
    for (const r of rows) observer.observe(r);

    return () => observer.disconnect();
  }, [displayRows.length, headerOffset]);

  const safeDur = Math.max(durationMs, 1);

  /* Build segments from the same display-row stream the transcript
     uses. Collapsed turns become one wide segment; expanded-turn
     headers are skipped; presentation rows (whether standalone or
     indented children of an expanded turn) become atomic segments. */
  const segs: MinimapSeg[] = useMemo(() => {
    const out: MinimapSeg[] = [];

    // Flatten to (item, start) pairs with the expanded-turn headers removed
    // and collapsed turns preserved as single-item entries.
    type WithTime =
      | { kind: "row"; row: PresentationRow; start: number; gapMs: number }
      | {
          kind: "turn";
          turn: TurnMegaRow;
          start: number;
          gapMs: number;
        };

    const withTime: WithTime[] = [];
    for (const d of displayRows) {
      if (d.kind === "turn-expanded-header") continue;
      if (d.kind === "turn-expanded-footer") continue;
      if (d.kind === "turn-collapsed") {
        if (d.turn.tOffsetMs === undefined) continue;
        withTime.push({
          kind: "turn",
          turn: d.turn,
          start: d.turn.tOffsetMs,
          gapMs: d.turn.rows[0]?.gapMs ?? 0,
        });
      } else {
        // presentation row
        if (d.row.tOffsetMs === undefined) continue;
        withTime.push({
          kind: "row",
          row: d.row,
          start: d.row.tOffsetMs,
          gapMs: d.row.gapMs ?? 0,
        });
      }
    }

    for (let i = 0; i < withTime.length; i++) {
      const item = withTime[i];
      const next = withTime[i + 1];
      const start = item.start;

      // Idle gap before user rows (only in atomic view — turns already
      // contain their idle time inside their duration).
      if (
        item.kind === "row" &&
        item.row.kind === "user" &&
        item.gapMs > IDLE_THRESHOLD_MS &&
        out.length > 0
      ) {
        out.push({
          kind: "idle",
          start: Math.max(0, start - item.gapMs),
          end: start,
          durationMs: item.gapMs,
        });
      }

      if (item.kind === "turn") {
        // Turn's end = start + duration, clamped against the next
        // segment's start so adjacent turns don't overlap.
        const turnEnd = start + (item.turn.durationMs ?? 0);
        const nextStart = next?.start;
        const end = nextStart !== undefined ? Math.min(turnEnd, nextStart) : turnEnd;
        out.push({
          kind: "turn",
          turn: item.turn,
          primaryIndex: item.turn.firstPrimaryIndex,
          start,
          end: Math.max(end, start + 1),
        });
      } else {
        const end = next?.start ?? Math.min(start + 800, safeDur);
        out.push({
          kind: "row",
          row: item.row,
          primaryIndex: rowPrimaryIndex(item.row),
          start,
          end,
        });
      }
    }

    // Cap the number of rendered segments. Each <rect> carries two
    // event handlers (onMouseEnter + onClick), so 2000 raw-events in
    // "All events" mode becomes 4000 DOM event listeners — enough to
    // stall Chrome during paint. Sampling to MAX contiguous buckets
    // loses per-item hover precision but keeps the overall shape and
    // click-to-navigate behavior (clicks map to the first row inside
    // the bucket, which is the right anchor for "jump here" UX).
    const MAX_SEGMENTS = 600;
    if (out.length <= MAX_SEGMENTS) return out;

    const step = Math.ceil(out.length / MAX_SEGMENTS);
    const bucketed: MinimapSeg[] = [];
    for (let i = 0; i < out.length; i += step) {
      const first = out[i]!;
      const last = out[Math.min(i + step - 1, out.length - 1)]!;
      // Merge bucket: keep the first seg's kind + primaryIndex (so clicks
      // jump to the first item of the bucket), but extend the end range
      // to cover the whole bucket's time span.
      if (first.kind === "idle") {
        bucketed.push({
          kind: "idle",
          start: first.start,
          end: last.end,
          durationMs: last.end - first.start,
        });
      } else if (first.kind === "turn") {
        bucketed.push({
          kind: "turn",
          turn: first.turn,
          primaryIndex: first.primaryIndex,
          start: first.start,
          end: last.end,
        });
      } else {
        bucketed.push({
          kind: "row",
          row: first.row,
          primaryIndex: first.primaryIndex,
          start: first.start,
          end: last.end,
        });
      }
    }
    return bucketed;
  }, [displayRows, safeDur]);

  /* Sequential layout with a minimum displayed width per segment.
     - Raw proportional width = (seg.end - seg.start) / safeDur * WIDTH
     - Enforced width = max(raw, MIN_DISPLAY_WIDTH)
     - x positions are cumulative (not time-proportional), so tiny events
       stay visible next to a 24-minute turn.
     - If the cumulative width exceeds WIDTH, proportionally shrink so it
       all fits. Time ordering is preserved; exact time-to-pixel mapping
       is sacrificed. */
  const positions: { x: number; w: number }[] = useMemo(() => {
    if (segs.length === 0) return [];
    const raws = segs.map((s) => ((s.end - s.start) / safeDur) * WIDTH);
    const enforced = raws.map((w) => Math.max(w, MIN_DISPLAY_WIDTH));
    const total = enforced.reduce((a, b) => a + b, 0);
    const scale = total > WIDTH ? WIDTH / total : 1;
    const out: { x: number; w: number }[] = [];
    let cursor = 0;
    for (const w of enforced) {
      const scaled = w * scale;
      out.push({ x: cursor, w: scaled });
      cursor += scaled;
    }
    return out;
  }, [segs, safeDur]);

  /** Map a time offset (ms) to an x coordinate in the relaxed layout.
   *  Walks segments sequentially and interpolates within whichever one
   *  contains the target ms. Used for the playhead indicator. */
  const msToX = (ms: number): number => {
    if (segs.length === 0) return 0;
    if (ms <= segs[0].start) return positions[0]?.x ?? 0;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const p = positions[i];
      if (!p) continue;
      if (ms < s.start) return p.x;
      if (ms <= s.end) {
        const segDur = s.end - s.start;
        const frac = segDur > 0 ? (ms - s.start) / segDur : 0;
        return p.x + frac * p.w;
      }
    }
    const last = positions[positions.length - 1];
    return last ? last.x + last.w : WIDTH;
  };

  // ---- Sub-agent lane assignment -------------------------------------
  // Place each subagent in the lowest lane index where it doesn't
  // collide with the most recent bar in that lane. Greedy left→right
  // sweep — O(N×L) where L is the number of lanes (small in practice).
  // Returns a Map agentId → laneIndex plus the total lane count.
  const { laneOf, laneCount } = useMemo(() => {
    if (!subagents || subagents.length === 0) {
      return { laneOf: new Map<string, number>(), laneCount: 0 };
    }
    const sorted = [...subagents].sort(
      (a, b) => (a.startTOffsetMs ?? 0) - (b.startTOffsetMs ?? 0),
    );
    const laneEnds: number[] = [];
    const laneOf = new Map<string, number>();
    for (const s of sorted) {
      const start = s.startTOffsetMs ?? 0;
      const end = s.endTOffsetMs ?? start + 1;
      let assigned = -1;
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i]! <= start) {
          assigned = i;
          break;
        }
      }
      if (assigned === -1) {
        assigned = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[assigned] = end;
      laneOf.set(s.agentId, assigned);
    }
    return { laneOf, laneCount: laneEnds.length };
  }, [subagents]);

  const SUB_BLOCK_TOP = MAIN_H + SUB_LANE_GAP;
  const SUB_LANES_H = laneCount > 0 ? laneCount * SUB_LANE_H : 0;
  const TOTAL_H = MAIN_H + (laneCount > 0 ? SUB_LANE_GAP + SUB_LANES_H : 0);

  return (
    <div
      ref={containerRef}
      style={{
        padding: "8px 10px",
        position: "relative",
        background: "var(--af-surface)",
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 8,
        marginTop: 2,
      }}
      onMouseLeave={() => setHover(null)}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${TOTAL_H}`}
        preserveAspectRatio="none"
        style={{
          width: "100%",
          height: TOTAL_H,
          display: "block",
          overflow: "visible",
        }}
      >
        <defs>
          <pattern
            id="stripes"
            patternUnits="userSpaceOnUse"
            width="6"
            height="6"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="rgba(120, 115, 108, 0.04)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(120, 115, 108, 0.28)" strokeWidth="2" />
          </pattern>
        </defs>

        {/* Segments — x/w come from the relaxed sequential layout, NOT
            from raw time proportions. See the positions memo above. */}
        {segs.map((seg, i) => {
          const pos = positions[i];
          if (!pos) return null;
          const xRaw = pos.x;
          const wRaw = pos.w;

          if (seg.kind === "idle") {
            // Idle block: fill its span minus a gap on each side, with a
            // subtle border so the diagonal stripes read as a distinct block.
            const w = Math.max(wRaw - GAP, MIN_BLOCK);
            return (
              <rect
                key={`idle-${i}`}
                x={xRaw + GAP / 2}
                y={BAR_TOP + 1}
                width={w}
                height={BAR_H - 2}
                fill="url(#stripes)"
                stroke="rgba(120, 115, 108, 0.35)"
                strokeWidth="0.6"
                rx="3"
                onMouseEnter={(e) =>
                  setHover({
                    clientX: e.clientX,
                    idleMs: seg.durationMs,
                  })
                }
              />
            );
          }

          // Resolve the theme + selection state. Turn segments use the
          // "agent" theme (a turn is the agent's work wrapped as one unit).
          const rowKind: PresentationRowKind = seg.kind === "turn" ? "agent" : seg.row.kind;
          const theme = ROLE_THEMES[rowKind];
          const importance = ROW_IMPORTANCE[rowKind];
          const h = BAR_H * importance;
          const y = BAR_TOP + (BAR_H - h) / 2;
          const isSelected = selectedIndex === seg.primaryIndex;

          // Error/interrupt: render as a THIN vertical bar regardless of
          // actual span. Consecutive errors become a visible comb of
          // narrow strokes separated by gaps, matching Claude's UI.
          const isThin =
            seg.kind === "row" && (seg.row.kind === "error" || seg.row.kind === "interrupt");
          let w: number;
          let x: number;
          if (isThin) {
            w = Math.min(Math.max(wRaw - GAP, 2), THIN_BAR_MAX);
            x = xRaw + Math.max((wRaw - w) / 2, GAP / 2);
          } else {
            w = Math.max(wRaw - GAP, MIN_BLOCK);
            x = xRaw + GAP / 2;
          }

          const ringPad = 2.5;
          const onHover = (e: React.MouseEvent) =>
            seg.kind === "turn"
              ? setHover({ clientX: e.clientX, turn: seg.turn })
              : setHover({ clientX: e.clientX, row: seg.row });
          return (
            <g key={`seg-${seg.primaryIndex}-${i}`}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill={theme.mini}
                rx="3"
                style={{ cursor: "pointer" }}
                onClick={() => onSelect(seg.primaryIndex)}
                onMouseEnter={onHover}
              />
              {isSelected && (
                <rect
                  x={x - ringPad}
                  y={y - ringPad}
                  width={w + ringPad * 2}
                  height={h + ringPad * 2}
                  fill="none"
                  stroke="#5C84C3"
                  strokeWidth="2"
                  rx="5"
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}

        {/* Sub-agent lanes — one row per lane, colored by agentType.
            Background-mode runs are highlighted with a brighter fill +
            extra dashed outline so you can spot true parallelism at a
            glance. Bars use the same msToX mapping as the main timeline
            so the subagent's start/end aligns vertically with whatever
            was happening in the main session at that time. */}
        {laneCount > 0 && subagents && (
          <g>
            {/* Faint divider line above the subagent lane block */}
            <line
              x1={0}
              x2={WIDTH}
              y1={MAIN_H + SUB_LANE_GAP / 2}
              y2={MAIN_H + SUB_LANE_GAP / 2}
              stroke="var(--af-border-subtle)"
              strokeWidth="0.6"
              strokeDasharray="2 4"
            />
            {subagents.map((s) => {
              const lane = laneOf.get(s.agentId) ?? 0;
              if (s.startTOffsetMs === undefined || s.endTOffsetMs === undefined) return null;
              const startX = msToX(s.startTOffsetMs);
              const endX = msToX(s.endTOffsetMs);
              // Minimum 8px so a 78-second subagent in a 16-hour session is
              // still wide enough to read + hit-test. Long subagents render
              // at their actual proportional width.
              const w = Math.max(endX - startX, 8);
              const y = SUB_BLOCK_TOP + lane * SUB_LANE_H;
              const h = SUB_LANE_H - 2;
              const fill = subagentColor(s.agentType, s.runInBackground);
              const isSelected = selectedSubagentId === s.agentId;
              return (
                <g key={s.agentId}>
                  <rect
                    x={startX}
                    y={y}
                    width={w}
                    height={h}
                    fill={fill}
                    stroke={s.runInBackground ? "#fff" : "transparent"}
                    strokeWidth={s.runInBackground ? 0.5 : 0}
                    strokeDasharray={s.runInBackground ? "1.5 1.5" : undefined}
                    rx="2"
                    style={{ cursor: "pointer" }}
                    onMouseEnter={(e) => setHover({ clientX: e.clientX, subagent: s })}
                    onClick={() => onSelectSubagent?.(isSelected ? null : s.agentId)}
                  />
                  {isSelected && (
                    <rect
                      x={startX - 2}
                      y={y - 2}
                      width={w + 4}
                      height={h + 4}
                      fill="none"
                      stroke="var(--af-accent)"
                      strokeWidth="1.5"
                      rx="4"
                      pointerEvents="none"
                    />
                  )}
                </g>
              );
            })}
          </g>
        )}

        {/* Playhead — positioned against the relaxed layout, not raw time.
            Spans the full SVG height (main + subagent lanes) so you can see
            which subagents were running at the current scroll position. */}
        {playheadMs !== null && (
          <line
            x1={msToX(playheadMs)}
            x2={msToX(playheadMs)}
            y1={0}
            y2={TOTAL_H}
            stroke="#0F172A"
            strokeWidth="1.25"
            strokeDasharray="2 2"
            opacity="0.65"
          />
        )}
      </svg>

      {/* Hover card */}
      {hover && (
        <MinimapHoverCard
          containerRef={containerRef}
          clientX={hover.clientX}
          row={hover.row}
          turn={hover.turn}
          idleMs={hover.idleMs}
          subagent={hover.subagent}
        />
      )}

      {/* Sub-agent legend strip — only when there are subagent lanes. */}
      {laneCount > 0 && subagents && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 6,
            fontSize: 10,
            color: "var(--af-text-tertiary)",
          }}
        >
          <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Sub-agents
          </span>
          <span>·</span>
          <span>
            {subagents.length} run{subagents.length === 1 ? "" : "s"}
          </span>
          <span style={{ marginLeft: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Array.from(new Set(subagents.map((s) => s.agentType))).map((type) => (
              <span
                key={type}
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: subagentColor(type, false),
                  }}
                />
                {type}
              </span>
            ))}
            {subagents.some((s) => s.runInBackground) && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: "transparent",
                    border: "1px dashed var(--af-text-secondary)",
                  }}
                />
                background
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

/** Color a sub-agent bar by its type. Background runs use a brighter
 *  variant of their color so true parallelism is visually distinct from
 *  blocking subagent calls (where the parent waits and there's no
 *  meaningful overlap with main session work). */
function subagentColor(agentType: string, background?: boolean): string {
  const palette: Record<string, [string, string]> = {
    "general-purpose": ["#5C84C3", "#7BA3DC"],
    Explore: ["#A855F7", "#C57BFF"],
    Plan: ["#F59E0B", "#FFBD3D"],
    "code-reviewer": ["#34D399", "#5EE5B0"],
    "playwright-qa-verifier": ["#22D3EE", "#67E8F9"],
    "claude-code-guide": ["#EC4899", "#F472B6"],
  };
  const [base, bright] = palette[agentType] ?? ["#8A8580", "#A8A19A"];
  return background ? bright : base;
}

function MinimapHoverCard({
  containerRef,
  clientX,
  row,
  turn,
  idleMs,
  subagent,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  clientX: number;
  row?: PresentationRow;
  turn?: TurnMegaRow;
  idleMs?: number;
  subagent?: SubagentRun;
}) {
  const rect = containerRef.current?.getBoundingClientRect();
  const localX = rect ? clientX - rect.left : 0;
  const left = Math.min(Math.max(localX - 140, 8), (rect?.width ?? 1400) - 300);

  if (subagent) {
    const startOff = formatOffset(subagent.startTOffsetMs);
    const endOff = formatOffset(subagent.endTOffsetMs);
    const dur = subagent.durationMs !== undefined ? formatGap(subagent.durationMs) : "";
    const totalIn =
      subagent.totalUsage.input + subagent.totalUsage.cacheRead + subagent.totalUsage.cacheWrite;
    return (
      <div
        style={{
          position: "absolute",
          top: -12,
          left,
          transform: "translateY(-100%)",
          zIndex: 100,
          background: "#0F172A",
          color: "#F1F5F9",
          borderRadius: 10,
          padding: "12px 14px",
          fontSize: 11,
          pointerEvents: "none",
          boxShadow: "0 6px 24px rgba(15,23,42,0.22)",
          maxWidth: 440,
          minWidth: 280,
          lineHeight: 1.45,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              background: subagentColor(subagent.agentType, subagent.runInBackground),
              color: "#fff",
            }}
          >
            {subagent.agentType}
          </span>
          {subagent.runInBackground && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 3,
                background: "rgba(251, 191, 36, 0.18)",
                color: "#FBBF24",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              background
            </span>
          )}
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              opacity: 0.7,
              marginLeft: "auto",
            }}
          >
            {startOff} → {endOff} · {dur}
          </span>
        </div>
        <div style={{ fontWeight: 500, marginBottom: 6 }}>{subagent.description}</div>
        <div
          style={{
            fontSize: 10,
            opacity: 0.65,
            display: "flex",
            gap: 8,
            paddingTop: 6,
            borderTop: "1px solid rgba(241,245,249,0.08)",
          }}
        >
          <span>{subagent.eventCount} events</span>
          <span>·</span>
          <span style={{ fontFamily: "var(--font-mono)" }}>
            {formatTokens(totalIn)}/{formatTokens(subagent.totalUsage.output)} tok
          </span>
        </div>
        {subagent.finalPreview && (
          <div
            style={{
              marginTop: 6,
              opacity: 0.78,
              fontStyle: "italic",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            → {subagent.finalPreview}
          </div>
        )}
      </div>
    );
  }

  if (idleMs !== undefined) {
    return (
      <div
        style={{
          position: "absolute",
          top: -12,
          left,
          transform: "translateY(-100%)",
          zIndex: 100,
          background: "#0F172A",
          color: "#F1F5F9",
          borderRadius: 10,
          padding: "8px 12px",
          fontSize: 11,
          pointerEvents: "none",
          boxShadow: "0 6px 24px rgba(15,23,42,0.22)",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 2 }}>Session idle</div>
        <div style={{ opacity: 0.78, fontFamily: "var(--font-mono)" }}>{formatGap(idleMs)}</div>
      </div>
    );
  }

  if (turn) {
    const theme = ROLE_THEMES.agent;
    const s = turn.summary;
    const dur = turn.durationMs !== undefined ? formatGap(turn.durationMs) : "";
    const startOff = formatOffset(turn.tOffsetMs);
    const endOff =
      turn.tOffsetMs !== undefined && turn.durationMs !== undefined
        ? formatOffset(turn.tOffsetMs + turn.durationMs)
        : undefined;
    const hasFirstLast =
      s.firstAgentPreview && s.finalAgentPreview && s.firstAgentPreview !== s.finalAgentPreview;
    // Top tools aggregated summary line (up to 3 entries)
    const topTools = s.toolNames
      .slice(0, 3)
      .map((t) =>
        t.count > 1 ? `${shortenToolName(t.name)} ×${t.count}` : shortenToolName(t.name),
      )
      .join(" · ");

    return (
      <div
        style={{
          position: "absolute",
          top: -12,
          left,
          transform: "translateY(-100%)",
          zIndex: 100,
          background: "#0F172A",
          color: "#F1F5F9",
          borderRadius: 10,
          padding: "12px 14px",
          fontSize: 11,
          pointerEvents: "none",
          boxShadow: "0 6px 24px rgba(15,23,42,0.22)",
          maxWidth: 440,
          minWidth: 280,
          lineHeight: 1.45,
        }}
      >
        {/* Header: Turn pill + start→end range */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              background: theme.mini,
              color: "#fff",
            }}
          >
            Turn
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              opacity: 0.7,
            }}
          >
            {endOff ? `${startOff} → ${endOff}` : startOff}
          </span>
          {dur && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                opacity: 0.55,
              }}
            >
              · {dur}
            </span>
          )}
        </div>

        {/* First agent message */}
        {s.firstAgentPreview && (
          <div
            style={{
              opacity: 0.95,
              fontWeight: 500,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              marginBottom: 6,
            }}
          >
            {s.firstAgentPreview}
          </div>
        )}

        {/* Middle: stats + top tools */}
        <div
          style={{
            fontSize: 10,
            opacity: 0.65,
            marginBottom: hasFirstLast ? 6 : 0,
            borderTop: s.firstAgentPreview ? "1px solid rgba(241,245,249,0.08)" : undefined,
            paddingTop: s.firstAgentPreview ? 6 : 0,
          }}
        >
          {s.agentMessages} msg · {s.toolCalls} tools
          {s.errors > 0 ? ` · ${s.errors} err` : ""}
          {topTools && (
            <>
              <span style={{ opacity: 0.5, margin: "0 4px" }}>·</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{topTools}</span>
              {s.toolNames.length > 3 && (
                <span style={{ opacity: 0.65 }}> +{s.toolNames.length - 3}</span>
              )}
            </>
          )}
        </div>

        {/* Last agent message */}
        {hasFirstLast && s.finalAgentPreview && (
          <div
            style={{
              opacity: 0.92,
              display: "flex",
              gap: 6,
              alignItems: "flex-start",
              borderTop: "1px solid rgba(241,245,249,0.08)",
              paddingTop: 6,
            }}
          >
            <span style={{ opacity: 0.5 }}>→</span>
            <span
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {s.finalAgentPreview}
            </span>
          </div>
        )}
      </div>
    );
  }

  if (!row) return null;

  const theme = ROLE_THEMES[row.kind];
  const preview = rowPreview(row);

  return (
    <div
      style={{
        position: "absolute",
        top: -12,
        left,
        transform: "translateY(-100%)",
        zIndex: 100,
        background: "#0F172A",
        color: "#F1F5F9",
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 11,
        pointerEvents: "none",
        boxShadow: "0 6px 24px rgba(15,23,42,0.22)",
        maxWidth: 360,
        minWidth: 220,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: 4,
            background: theme.mini,
            color: "#fff",
          }}
        >
          {theme.label}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            opacity: 0.65,
          }}
        >
          {formatOffset(row.tOffsetMs)}
        </span>
      </div>
      <div
        style={{
          lineHeight: 1.45,
          opacity: 0.92,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {preview}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Transcript list + rows                                            */
/* ------------------------------------------------------------------ */

function TranscriptList({
  displayRows,
  rowRefs,
  selectedIndex,
  onSelect,
  onToggleTurn,
  stickyOffset,
}: {
  displayRows: DisplayRow[];
  rowRefs: React.MutableRefObject<Record<number, HTMLDivElement | null>>;
  selectedIndex: number | null;
  onSelect: (i: number | null) => void;
  onToggleTurn: (firstPrimaryIndex: number) => void;
  stickyOffset: number;
}) {
  const out: React.ReactNode[] = [];
  for (let i = 0; i < displayRows.length; i++) {
    const d = displayRows[i];

    // Collapsed turn summary row
    if (d.kind === "turn-collapsed") {
      const idx = d.turn.firstPrimaryIndex;
      out.push(
        <CollapsedTurnRow
          key={`turn-${idx}`}
          turn={d.turn}
          stickyOffset={stickyOffset}
          onClick={() => onToggleTurn(idx)}
          refCb={(el) => {
            rowRefs.current[idx] = el;
          }}
        />,
      );
      continue;
    }

    // Expanded turn header
    if (d.kind === "turn-expanded-header") {
      out.push(
        <ExpandedTurnHeader
          key={`turnhead-${d.turn.firstPrimaryIndex}`}
          turn={d.turn}
          onClick={() => onToggleTurn(d.turn.firstPrimaryIndex)}
        />,
      );
      continue;
    }

    // Expanded turn footer — matching collapse control at the bottom of
    // the expanded rows so the user can collapse right where their eye
    // lands after reading through the content.
    if (d.kind === "turn-expanded-footer") {
      out.push(
        <ExpandedTurnFooter
          key={`turnfoot-${d.turn.firstPrimaryIndex}`}
          turn={d.turn}
          onClick={() => onToggleTurn(d.turn.firstPrimaryIndex)}
        />,
      );
      continue;
    }

    // Normal presentation row (possibly indented as a child of an expanded turn)
    const r = d.row;
    const gap = r.gapMs ?? 0;
    if (r.kind === "user" && gap > IDLE_THRESHOLD_MS && !d.indented) {
      out.push(<IdleDivider key={`idle-${rowPrimaryIndex(r)}`} gapMs={gap} />);
    }
    const idx = rowPrimaryIndex(r);
    out.push(
      <TranscriptRow
        key={`row-${idx}`}
        row={r}
        selected={selectedIndex === idx}
        onSelect={() => onSelect(idx)}
        stickyOffset={stickyOffset}
        indented={d.indented}
        refCb={(el) => {
          rowRefs.current[idx] = el;
        }}
      />,
    );
  }
  return <div>{out}</div>;
}

function IdleDivider({ gapMs }: { gapMs: number }) {
  return (
    <div
      style={{
        margin: "8px 0",
        padding: "6px 12px",
        textAlign: "center",
        background:
          "repeating-linear-gradient(135deg, rgba(107,101,96,0.04) 0px, rgba(107,101,96,0.04) 6px, rgba(107,101,96,0.12) 6px, rgba(107,101,96,0.12) 12px)",
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 6,
        fontSize: 11,
        color: "var(--af-text-tertiary)",
        letterSpacing: "0.02em",
      }}
    >
      Session idle · {formatGap(gapMs)}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Collapsed turn row                                                 */
/*                                                                     */
/*  Three-line layout:                                                 */
/*    1. First agent preview (intent / plan)                           */
/*    2. Middle summary (counts + top tools + duration)                */
/*    3. Final agent preview (answer / conclusion)                     */
/* ------------------------------------------------------------------ */

/** Max number of steps shown inline in a collapsed turn. Larger turns are
 *  truncated with a "+N more" line; the user can click to expand the turn
 *  to see everything. */
const MAX_INLINE_STEPS = 12;

function CollapsedTurnRow({
  turn,
  onClick,
  refCb,
  stickyOffset,
}: {
  turn: TurnMegaRow;
  /** Fires when the user wants to fully expand this turn into the
   *  transcript list (inner rows appear below as separate TranscriptRow
   *  entries). Triggered by the "Show all N steps" bottom bar. */
  onClick: () => void;
  refCb: (el: HTMLDivElement | null) => void;
  stickyOffset: number;
}) {
  const theme = ROLE_THEMES.agent;
  const s = turn.summary;
  const hasTokens = s.totalTokens.input > 0 || s.totalTokens.output > 0;

  // First / conclusion agent-message indices are pre-computed by
  // buildMegaRows — the "conclusion" uses a heuristic that skips short
  // codas following a task-notification (so e.g. "Ship done..." beats
  // a later "Acknowledged — the background task closed out").
  const firstAgentIdx = s.firstAgentIndex ?? -1;
  const finalAgentIdx = s.finalAgentIndex ?? -1;
  const firstAgentRow = firstAgentIdx >= 0 ? turn.rows[firstAgentIdx] : undefined;
  const finalAgentRow =
    finalAgentIdx >= 0 && finalAgentIdx !== firstAgentIdx ? turn.rows[finalAgentIdx] : undefined;

  // Middle list excludes the first and conclusion messages. Any coda
  // messages (e.g. "Acknowledged ...") remain visible here as ordinary
  // steps — they happened, they just aren't the semantic conclusion.
  const middleRows = turn.rows.filter((_, i) => {
    if (i === firstAgentIdx) return false;
    if (finalAgentRow && i === finalAgentIdx) return false;
    return true;
  });

  // Local state: whether the first / last message is rendered in full
  // markdown form inline (instead of the 2-line preview).
  const [firstExpanded, setFirstExpanded] = useState(false);
  const [lastExpanded, setLastExpanded] = useState(false);

  // Stop click propagation on interactive children so clicks on the
  // expandable message areas don't bubble up and trigger onClick on the
  // whole row — we want explicit controls only.
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      ref={refCb}
      data-sl-row-index={turn.firstPrimaryIndex}
      data-sl-toffset={turn.tOffsetMs ?? 0}
      style={{
        display: "grid",
        gridTemplateColumns: "20px 74px 1fr auto auto",
        columnGap: 12,
        alignItems: "start",
        padding: "14px 12px 0 12px",
        borderBottom: "1px solid var(--af-border-subtle)",
        transition: "background 0.08s",
        scrollMarginTop: stickyOffset,
      }}
    >
      {/* Col 1 — Chevron (grid column 1). Aligns with the 20px empty
          slot in TranscriptRow so role pills share the same x-offset. */}
      <span
        style={{
          color: "var(--af-text-tertiary)",
          paddingTop: 2,
        }}
      >
        <ChevronRight size={16} />
      </span>

      {/* Col 2 — "Agent" role pill */}
      <span
        style={{
          justifySelf: "start",
          fontSize: 11,
          fontWeight: 600,
          padding: "3px 10px",
          borderRadius: 4,
          background: theme.bg,
          color: theme.fg,
          marginTop: 2,
        }}
      >
        Agent
      </span>

      {/* Col 3 — content (first · stats · steps · last · bottom bar) */}
      <div
        style={{
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          paddingBottom: 10,
        }}
      >
        {/* 1. First agent message — clickable to expand into full markdown */}
        {firstAgentRow && (
          <ExpandableMessage
            label="First message"
            row={firstAgentRow as Extract<PresentationRow, { kind: "agent" }>}
            expanded={firstExpanded}
            onToggle={(e) => {
              stop(e);
              setFirstExpanded((v) => !v);
            }}
          />
        )}

        {/* Stats line */}
        <div onClick={stop}>
          <TurnStatsLine summary={s} durationMs={turn.durationMs} />
        </div>

        {/* 2. Steps list — each middle row as a compact bullet */}
        {middleRows.length > 0 && (
          <div onClick={stop}>
            <TurnStepsList rows={middleRows} />
          </div>
        )}

        {/* 3. Conclusion agent message — heuristically selected to skip
            short codas triggered by task-notifications. Same expand
            pattern as first. */}
        {finalAgentRow && (
          <ExpandableMessage
            label="Conclusion"
            row={finalAgentRow as Extract<PresentationRow, { kind: "agent" }>}
            expanded={lastExpanded}
            onToggle={(e) => {
              stop(e);
              setLastExpanded((v) => !v);
            }}
            arrow
          />
        )}

        {/* Bottom bar — explicit "expand full turn" action */}
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            onClick();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            width: "100%",
            padding: "7px 10px",
            marginTop: 4,
            background: "var(--af-surface-hover)",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 500,
            color: "var(--af-text-secondary)",
            fontFamily: "inherit",
            cursor: "pointer",
            transition: "all 0.1s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--af-surface-elevated)";
            e.currentTarget.style.color = "var(--af-text)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--af-surface-hover)";
            e.currentTarget.style.color = "var(--af-text-secondary)";
          }}
        >
          <ChevronDown size={13} />
          Show all {turn.rows.length} step{turn.rows.length === 1 ? "" : "s"}
        </button>
      </div>

      {/* Col 4 — Token chip with hover breakdown */}
      <span style={{ marginTop: 3 }}>{hasTokens && <TurnTokenChip usage={s.totalTokens} />}</span>

      {/* Col 5 — Offset */}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          marginTop: 3,
          minWidth: 64,
          textAlign: "right",
        }}
      >
        {formatOffset(turn.tOffsetMs)}
      </span>
    </div>
  );
}

/** Expandable first/last message inside a collapsed turn. Shows a 2-line
 *  clamped preview by default; clicking expands into a full markdown
 *  rendering for reading the agent's intent/conclusion in context. */
function ExpandableMessage({
  label,
  row,
  expanded,
  onToggle,
  arrow,
}: {
  label: string;
  row: Extract<PresentationRow, { kind: "agent" }>;
  expanded: boolean;
  onToggle: (e: React.MouseEvent) => void;
  arrow?: boolean;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "6px 10px",
        borderRadius: 6,
        background: expanded ? "var(--af-surface-hover)" : "transparent",
        border: expanded ? "1px solid var(--af-border-subtle)" : "1px solid transparent",
        cursor: "pointer",
        transition: "all 0.12s",
        borderTop: arrow && !expanded ? "1px dashed var(--af-border-subtle)" : undefined,
      }}
      onMouseEnter={(e) => {
        if (!expanded) e.currentTarget.style.background = "var(--af-surface-hover)";
      }}
      onMouseLeave={(e) => {
        if (!expanded) e.currentTarget.style.background = "transparent";
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 10,
          color: "var(--af-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          fontWeight: 600,
        }}
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {label}
      </div>
      {expanded ? (
        <div className="sl-prose" style={{ fontSize: 13 }}>
          {row.event.blocks
            .filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b, i) => (
              <ReactMarkdown
                key={i}
                remarkPlugins={[remarkGfm]}
                components={{
                  a: (props) => (
                    <a
                      {...props}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "var(--af-accent)",
                        textDecoration: "underline",
                      }}
                    />
                  ),
                }}
              >
                {b.text}
              </ReactMarkdown>
            ))}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "flex-start",
            fontSize: 13,
            lineHeight: 1.45,
            color: "var(--af-text)",
            fontWeight: 500,
          }}
        >
          {arrow && (
            <span
              style={{
                color: "var(--af-text-tertiary)",
                fontSize: 11,
                marginTop: 1,
              }}
            >
              →
            </span>
          )}
          <span
            style={{
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {row.event.preview}
          </span>
        </div>
      )}
    </div>
  );
}

/** One-line "8 messages · 23 tools · 5m 12s" stat strip at the top of
 *  a collapsed turn. Aggregates at a glance. */
function TurnStatsLine({ summary, durationMs }: { summary: TurnSummary; durationMs?: number }) {
  const parts: React.ReactNode[] = [];
  if (summary.agentMessages > 0) {
    parts.push(
      <span key="msgs">
        {summary.agentMessages} message{summary.agentMessages === 1 ? "" : "s"}
      </span>,
    );
  }
  if (summary.toolCalls > 0) {
    parts.push(
      <span key="tools">
        {summary.toolCalls} tool call{summary.toolCalls === 1 ? "" : "s"}
      </span>,
    );
  }
  if (summary.errors > 0) {
    parts.push(
      <span key="errs" style={{ color: "var(--af-danger)" }}>
        {summary.errors} error{summary.errors === 1 ? "" : "s"}
      </span>,
    );
  }
  if (durationMs !== undefined && durationMs > 0) {
    parts.push(<span key="dur">{formatGap(durationMs)}</span>);
  }
  if (parts.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 11,
        color: "var(--af-text-tertiary)",
        flexWrap: "wrap",
      }}
    >
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span style={{ opacity: 0.5 }}>·</span>}
          {p}
        </React.Fragment>
      ))}
    </div>
  );
}

/** Bulleted list of everything that happened in the middle of a turn.
 *  Each row is a one-line compact entry with role + preview. Capped at
 *  MAX_INLINE_STEPS items with an overflow indicator. */
function TurnStepsList({ rows }: { rows: PresentationRow[] }) {
  const overflow = Math.max(0, rows.length - MAX_INLINE_STEPS);
  const shown = overflow > 0 ? rows.slice(0, MAX_INLINE_STEPS) : rows;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        paddingLeft: 2,
        borderLeft: "1px solid var(--af-border-subtle)",
        paddingBlock: 2,
      }}
    >
      {shown.map((r, i) => (
        <TurnStepLine key={i} row={r} />
      ))}
      {overflow > 0 && (
        <div
          style={{
            fontSize: 11,
            color: "var(--af-text-tertiary)",
            fontStyle: "italic",
            paddingLeft: 12,
            paddingTop: 2,
          }}
        >
          … {overflow} more step{overflow === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}

/** One step in the middle list. Renders a small role marker + the preview
 *  for that row, truncated to one line. */
function TurnStepLine({ row }: { row: PresentationRow }) {
  const theme = ROLE_THEMES[row.kind];
  const label = theme.label;
  const preview = rowPreview(row);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "46px 1fr",
        columnGap: 8,
        fontSize: 12,
        lineHeight: 1.45,
        color: row.kind === "error" ? "var(--af-danger)" : "var(--af-text-secondary)",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          background: theme.bg,
          color: theme.fg,
          padding: "1px 6px",
          borderRadius: 3,
          textAlign: "center",
          justifySelf: "start",
          maxWidth: "100%",
        }}
      >
        {label}
      </span>
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {row.kind === "tool-group" ? (
          <span>
            {row.toolNames.slice(0, 4).map((t, i) => (
              <span key={t.name}>
                {i > 0 && (
                  <span style={{ color: "var(--af-text-tertiary)", margin: "0 5px" }}>·</span>
                )}
                <b style={{ fontWeight: 600 }}>{shortenToolName(t.name)}</b>
                {t.count > 1 && (
                  <span
                    style={{
                      color: "var(--af-text-tertiary)",
                      fontFamily: "var(--font-mono)",
                      marginLeft: 3,
                    }}
                  >
                    ×{t.count}
                  </span>
                )}
              </span>
            ))}
            {row.toolNames.length > 4 && (
              <span
                style={{
                  color: "var(--af-text-tertiary)",
                  marginLeft: 6,
                  fontSize: 10,
                }}
              >
                +{row.toolNames.length - 4}
              </span>
            )}
          </span>
        ) : (
          preview
        )}
      </span>
    </div>
  );
}

function ExpandedTurnHeader({ turn, onClick }: { turn: TurnMegaRow; onClick: () => void }) {
  const s = turn.summary;
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px 6px 18px",
        marginLeft: 12,
        borderLeft: "2px solid var(--af-accent)",
        borderBottom: "1px dashed var(--af-border-subtle)",
        fontSize: 11,
        color: "var(--af-text-tertiary)",
        cursor: "pointer",
        background: "rgba(92, 132, 195, 0.04)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(92, 132, 195, 0.10)";
        e.currentTarget.style.color = "var(--af-text-secondary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(92, 132, 195, 0.04)";
        e.currentTarget.style.color = "var(--af-text-tertiary)";
      }}
    >
      <ChevronDown size={13} />
      <span>
        Hide turn · {s.agentMessages} message{s.agentMessages === 1 ? "" : "s"} · {s.toolCalls} tool
        {s.toolCalls === 1 ? "" : "s"}
        {turn.durationMs !== undefined ? ` · ${formatGap(turn.durationMs)}` : ""}
      </span>
    </div>
  );
}

/** Matching collapse control at the bottom of an expanded turn. Mirrors
 *  the top ExpandedTurnHeader so after reading through the inner rows
 *  the user has a collapse button right where their eye lands. */
function ExpandedTurnFooter({ turn, onClick }: { turn: TurnMegaRow; onClick: () => void }) {
  const s = turn.summary;
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 12px 7px 18px",
        marginLeft: 12,
        marginBottom: 8,
        borderLeft: "2px solid var(--af-accent)",
        borderTop: "1px dashed var(--af-border-subtle)",
        borderBottomLeftRadius: 6,
        borderBottomRightRadius: 6,
        fontSize: 11,
        color: "var(--af-text-tertiary)",
        cursor: "pointer",
        background: "rgba(92, 132, 195, 0.04)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(92, 132, 195, 0.10)";
        e.currentTarget.style.color = "var(--af-text-secondary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(92, 132, 195, 0.04)";
        e.currentTarget.style.color = "var(--af-text-tertiary)";
      }}
    >
      <ChevronUp size={13} />
      <span>
        Collapse turn · {s.agentMessages} message{s.agentMessages === 1 ? "" : "s"} · {s.toolCalls}{" "}
        tool{s.toolCalls === 1 ? "" : "s"}
        {turn.durationMs !== undefined ? ` · ${formatGap(turn.durationMs)}` : ""}
      </span>
    </div>
  );
}

function TranscriptRow({
  row,
  selected,
  onSelect,
  refCb,
  stickyOffset,
  indented,
}: {
  row: PresentationRow;
  selected: boolean;
  onSelect: () => void;
  refCb: (el: HTMLDivElement | null) => void;
  stickyOffset: number;
  indented?: boolean;
}) {
  const theme = ROLE_THEMES[row.kind];
  const event = row.kind === "tool-group" ? row.events[0] : row.event;
  const usage = event.usage;
  const hasUsage = row.kind === "agent" && usage && (usage.input > 0 || usage.output > 0);

  const preview = rowPreview(row);

  return (
    <div
      ref={refCb}
      onClick={onSelect}
      data-sl-row-index={row.kind === "tool-group" ? row.events[0].index : row.event.index}
      data-sl-toffset={row.tOffsetMs ?? 0}
      style={{
        display: "grid",
        // Empty 20px prefix column keeps the role pill at the same x-offset
        // as collapsed turn rows (which have a chevron there). Ensures the
        // User/Agent/Tool tags align vertically in the transcript.
        gridTemplateColumns: "20px 74px 1fr auto auto",
        gap: 14,
        alignItems: "center",
        padding: "11px 12px",
        paddingLeft: indented ? 28 : 12,
        borderBottom: "1px solid var(--af-border-subtle)",
        borderLeft: indented ? "2px solid var(--af-accent)" : "2px solid transparent",
        marginLeft: indented ? 12 : 0,
        cursor: "pointer",
        background: selected
          ? "var(--af-accent-subtle)"
          : indented
            ? "rgba(92, 132, 195, 0.03)"
            : "transparent",
        transition: "background 0.08s",
        scrollMarginTop: stickyOffset,
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = "var(--af-surface-hover)";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = "transparent";
      }}
    >
      {/* Empty chevron-slot column — keeps the pill column aligned with
          collapsed-turn rows that do render a chevron. */}
      <span />
      <span
        style={{
          justifySelf: "start",
          fontSize: 11,
          fontWeight: 600,
          padding: "3px 10px",
          borderRadius: 4,
          background: theme.bg,
          color: theme.fg,
        }}
      >
        {theme.label}
      </span>

      <span
        style={{
          fontSize: 13,
          color: row.kind === "error" ? "var(--af-danger)" : "var(--af-text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {row.kind === "tool-group" && (
          <Wrench size={13} style={{ color: "var(--af-text-tertiary)", flexShrink: 0 }} />
        )}
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {row.kind === "tool-group" ? (
            <ToolGroupLabel toolNames={row.toolNames} count={row.count} />
          ) : (
            preview
          )}
        </span>
      </span>

      {hasUsage && usage ? <TokenChip usage={usage} /> : <span />}

      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          minWidth: 64,
          textAlign: "right",
        }}
      >
        {formatOffset(row.tOffsetMs)}
      </span>
    </div>
  );
}

/* -------- Token chip w/ hover tooltip -------- */

/** Pretty inline label for a collapsed tool-group row. Shows unique tool
 *  names with bolded names and subtle "×N" counts. */
function ToolGroupLabel({
  toolNames,
  count,
}: {
  toolNames: { name: string; count: number }[];
  count: number;
}) {
  const MAX = 4;
  const shown = toolNames.slice(0, MAX);
  const overflow = toolNames.length - MAX;
  return (
    <span>
      {shown.map((t, i) => (
        <span key={t.name}>
          {i > 0 && <span style={{ color: "var(--af-text-tertiary)", margin: "0 6px" }}>·</span>}
          <b>{shortenToolName(t.name)}</b>
          {t.count > 1 && (
            <span
              style={{
                color: "var(--af-text-tertiary)",
                fontWeight: 400,
                marginLeft: 4,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
            >
              ×{t.count}
            </span>
          )}
        </span>
      ))}
      {overflow > 0 && (
        <span
          style={{
            color: "var(--af-text-tertiary)",
            marginLeft: 8,
            fontSize: 11,
          }}
        >
          +{overflow} more
        </span>
      )}
      {count > 3 && (
        <span
          style={{
            color: "var(--af-text-tertiary)",
            marginLeft: 10,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
          }}
        >
          ({count} calls)
        </span>
      )}
    </span>
  );
}

function TokenChip({ usage }: { usage: NonNullable<SessionEvent["usage"]> }) {
  const [hover, setHover] = useState(false);
  const totalIn = usage.input + usage.cacheRead + usage.cacheWrite;
  const pctRead = totalIn > 0 ? Math.round((usage.cacheRead / totalIn) * 100) : 0;
  return (
    <span
      style={{
        position: "relative",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--af-text-secondary)",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        whiteSpace: "nowrap",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span style={{ opacity: 0.6 }}>▤</span>
      {formatTokens(totalIn)} / {formatTokens(usage.output)}
      {hover && (
        <Tooltip style={{ right: 0, top: "calc(100% + 6px)", minWidth: 180 }}>
          <TooltipRow label="Input" value={usage.input.toLocaleString()} />
          <TooltipRow
            label="Cache read"
            value={`${usage.cacheRead.toLocaleString()} (${pctRead}%)`}
          />
          <TooltipRow label="Cache write" value={usage.cacheWrite.toLocaleString()} />
          <TooltipRow label="Output" value={usage.output.toLocaleString()} />
        </Tooltip>
      )}
    </span>
  );
}

/** Like TokenChip but for per-turn aggregates. Primary display is
 *  fresh input / output (not the cache-inflated sum), consistent with
 *  the session header. Tooltip shows the full breakdown plus a footnote
 *  reminding that cache reads are cumulative. */
function TurnTokenChip({
  usage,
}: {
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}) {
  const [hover, setHover] = useState(false);
  const totalIn = usage.input + usage.cacheRead + usage.cacheWrite;
  const pctRead = totalIn > 0 ? Math.round((usage.cacheRead / totalIn) * 100) : 0;
  return (
    <span
      style={{
        position: "relative",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--af-text-tertiary)",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        whiteSpace: "nowrap",
        cursor: "default",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span style={{ opacity: 0.6 }}>▤</span>
      {formatTokens(usage.input)} / {formatTokens(usage.output)}
      {hover && (
        <Tooltip style={{ right: 0, top: "calc(100% + 6px)", minWidth: 220 }}>
          <TooltipRow label="Input (fresh)" value={usage.input.toLocaleString()} />
          <TooltipRow label="Output" value={usage.output.toLocaleString()} />
          <TooltipRow
            label="Cache read"
            value={`${usage.cacheRead.toLocaleString()} (${pctRead}%)`}
          />
          <TooltipRow label="Cache write" value={usage.cacheWrite.toLocaleString()} />
          <div
            style={{
              marginTop: 6,
              paddingTop: 6,
              borderTop: "1px solid rgba(241,245,249,0.12)",
              opacity: 0.65,
              fontSize: 10,
              whiteSpace: "normal",
              lineHeight: 1.4,
            }}
          >
            Cumulative across all requests in this turn.
          </div>
        </Tooltip>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Debug list                                                         */
/* ------------------------------------------------------------------ */

function DebugList({ events }: { events: SessionEvent[] }) {
  // Rebuild a JSON view from the structured fields on the event. The
  // original `raw` field is stripped server-side before serialization
  // (see app/sessions/[id]/page.tsx) because including the full JSONL
  // line per event doubles the RSC payload on large sessions. All the
  // useful data is already on the structured event; this view surfaces
  // it in the same shape you'd get from the raw JSONL.
  const shapeForDebug = (e: SessionEvent) => ({
    type: e.rawType,
    index: e.index,
    uuid: e.uuid,
    parentUuid: e.parentUuid,
    timestamp: e.timestamp,
    role: e.role,
    messageId: e.messageId,
    stopReason: e.stopReason,
    model: e.model,
    requestId: e.requestId,
    toolName: e.toolName,
    toolUseId: e.toolUseId,
    attachmentType: e.attachmentType,
    usage: e.usage,
    blocks: e.blocks,
  });

  return (
    <div style={{ padding: "8px 0" }}>
      {events.map((e) => (
        <details
          key={e.index}
          style={{
            borderBottom: "1px solid var(--af-border-subtle)",
            padding: "8px 12px",
          }}
        >
          <summary
            style={{
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--af-text-secondary)",
            }}
          >
            #{e.index} · {e.rawType}
            {e.attachmentType ? `/${e.attachmentType}` : ""} · {e.timestamp ?? "(no ts)"}
          </summary>
          <pre
            style={{
              marginTop: 8,
              padding: 12,
              background: "var(--background)",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 6,
              fontSize: 11,
              overflow: "auto",
              maxHeight: 400,
              color: "var(--af-text-secondary)",
            }}
          >
            {JSON.stringify(shapeForDebug(e), null, 2)}
          </pre>
        </details>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SubagentDrawer                                                    */
/*                                                                     */
/*  Opened when the user clicks a sub-agent lane bar on the mini-map. */
/*  Renders everything we know about the run — type pill, background  */
/*  badge, timing range, duration, stats, the full prompt the parent  */
/*  dispatched, the final agent text, and a "Jump to parent" action   */
/*  that scrolls the transcript to the Agent tool_use row that kicked */
/*  this subagent off.                                                */
/* ------------------------------------------------------------------ */

function SubagentDrawer({
  subagent,
  onClose,
  onJumpToParent,
}: {
  subagent: SubagentRun;
  onClose: () => void;
  onJumpToParent: () => void;
}) {
  const s = subagent;
  const fill = subagentColor(s.agentType, s.runInBackground);
  const startOff = formatOffset(s.startTOffsetMs);
  const endOff = formatOffset(s.endTOffsetMs);
  const dur = s.durationMs !== undefined ? formatGap(s.durationMs) : "—";
  const totalIn = s.totalUsage.input + s.totalUsage.cacheRead + s.totalUsage.cacheWrite;
  const pctRead = totalIn > 0 ? Math.round((s.totalUsage.cacheRead / totalIn) * 100) : 0;

  return (
    <div>
      {/* Sticky title bar */}
      <div
        style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--af-border-subtle)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--af-surface)",
          position: "sticky",
          top: 0,
          zIndex: 1,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 10px",
            borderRadius: 4,
            background: fill,
            color: "#fff",
          }}
        >
          {s.agentType}
        </span>
        {s.runInBackground && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 4,
              background: "var(--af-warning-subtle)",
              color: "var(--af-warning)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            background
          </span>
        )}
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--af-text)",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={s.description}
        >
          {s.description}
        </span>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--af-text-tertiary)",
            padding: 4,
            borderRadius: 4,
          }}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* Meta strip */}
      <div
        style={{
          padding: "10px 20px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          borderBottom: "1px solid var(--af-border-subtle)",
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          columnGap: 10,
          rowGap: 3,
        }}
      >
        <span style={{ opacity: 0.7 }}>range</span>
        <span style={{ color: "var(--af-text-secondary)" }}>
          {startOff} → {endOff}
        </span>
        <span style={{ opacity: 0.7 }}>duration</span>
        <span style={{ color: "var(--af-text-secondary)" }}>{dur}</span>
        {s.model && (
          <>
            <span style={{ opacity: 0.7 }}>model</span>
            <span style={{ color: "var(--af-text-secondary)" }}>{s.model}</span>
          </>
        )}
        {s.parentToolUseId && (
          <>
            <span style={{ opacity: 0.7 }}>parent</span>
            <span style={{ color: "var(--af-text-secondary)" }}>
              {s.parentToolUseId.slice(0, 24)}…
            </span>
          </>
        )}
      </div>

      {/* Activity stats */}
      <div
        style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--af-border-subtle)",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 10,
        }}
      >
        <StatCell label="Events" value={String(s.eventCount)} />
        <StatCell label="Messages" value={String(s.assistantMessageCount ?? 0)} />
        <StatCell label="Tool calls" value={String(s.toolCallCount ?? 0)} />
      </div>

      {/* Token breakdown */}
      <div
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid var(--af-border-subtle)",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color: "var(--af-text-secondary)",
          display: "flex",
          flexDirection: "column",
          gap: 3,
        }}
      >
        <TokenLine label="Input (fresh)" value={s.totalUsage.input} />
        <TokenLine label="Output" value={s.totalUsage.output} />
        <TokenLine
          label="Cache read"
          value={s.totalUsage.cacheRead}
          suffix={` (${pctRead}%)`}
        />
        <TokenLine label="Cache write" value={s.totalUsage.cacheWrite} />
      </div>

      {/* Tool breakdown */}
      {s.toolCalls && s.toolCalls.length > 0 && (
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--af-border-subtle)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--af-text-tertiary)",
              marginBottom: 8,
            }}
          >
            Tools used
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {s.toolCalls.map((t) => (
              <span
                key={t.name}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: "var(--af-border-subtle)",
                  color: "var(--af-text)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                <b style={{ fontWeight: 600 }}>{shortenToolName(t.name)}</b>
                <span style={{ color: "var(--af-text-tertiary)" }}>×{t.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Parent prompt (what the parent asked the subagent to do) */}
      {s.prompt && (
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--af-border-subtle)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--af-text-tertiary)",
              }}
            >
              Prompt
            </div>
            {s.parentToolUseId && (
              <button
                type="button"
                onClick={onJumpToParent}
                style={{
                  fontSize: 10,
                  color: "var(--af-accent)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Jump to parent →
              </button>
            )}
          </div>
          <div className="sl-prose" style={{ fontSize: 12.5 }}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: (props) => (
                  <a
                    {...props}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: "var(--af-accent)",
                      textDecoration: "underline",
                    }}
                  />
                ),
              }}
            >
              {s.prompt}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Final text */}
      {s.finalText && (
        <div style={{ padding: "14px 20px" }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--af-text-tertiary)",
              marginBottom: 8,
            }}
          >
            Final result
          </div>
          <div className="sl-prose" style={{ fontSize: 13 }}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: (props) => (
                  <a
                    {...props}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: "var(--af-accent)",
                      textDecoration: "underline",
                    }}
                  />
                ),
              }}
            >
              {s.finalText}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          color: "var(--af-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          fontFamily: "var(--font-mono)",
          color: "var(--af-text)",
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function TokenLine({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span>
        {value.toLocaleString()}
        {suffix && <span style={{ opacity: 0.65 }}>{suffix}</span>}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Drawer                                                             */
/* ------------------------------------------------------------------ */

function Drawer({
  event,
  row,
  onClose,
}: {
  event: SessionEvent;
  row: PresentationRow | null;
  onClose: () => void;
}) {
  const [showDev, setShowDev] = useState(false);
  const kind: PresentationRowKind = row?.kind ?? "agent";
  const theme = ROLE_THEMES[kind];
  const title = drawerTitle(row, event);
  const hasUsage = !!event.usage && (event.usage.input > 0 || event.usage.output > 0);

  return (
    <div>
      {/* Sticky title bar */}
      <div
        style={{
          padding: "14px 20px",
          borderBottom: "1px solid var(--af-border-subtle)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--af-surface)",
          position: "sticky",
          top: 0,
          zIndex: 1,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 10px",
            borderRadius: 4,
            background: theme.bg,
            color: theme.fg,
          }}
        >
          {theme.label}
        </span>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--af-text)",
          }}
        >
          {title}
        </span>
        <button
          onClick={onClose}
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--af-text-tertiary)",
            padding: 4,
            borderRadius: 4,
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Meta line — compact */}
      <div
        style={{
          padding: "8px 20px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
          borderBottom: "1px solid var(--af-border-subtle)",
        }}
      >
        <span>{formatOffset(event.tOffsetMs)}</span>
        {event.gapMs !== undefined && event.gapMs > 0 && <span>· {formatGap(event.gapMs)}</span>}
        {hasUsage && event.usage && (
          <span style={{ color: "var(--af-text-secondary)" }}>
            · {formatTokens(event.usage.input + event.usage.cacheRead + event.usage.cacheWrite)}/
            {formatTokens(event.usage.output)} tokens
          </span>
        )}
        <button
          onClick={() => setShowDev((s) => !s)}
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: "none",
            fontSize: 10,
            color: "var(--af-text-tertiary)",
            cursor: "pointer",
            padding: 0,
            fontFamily: "inherit",
            textDecoration: "underline",
            textUnderlineOffset: 2,
          }}
        >
          {showDev ? "hide details" : "details"}
        </button>
      </div>

      {/* Developer panel — collapsed by default */}
      {showDev && (
        <div
          style={{
            padding: "10px 20px 14px",
            borderBottom: "1px solid var(--af-border-subtle)",
            fontSize: 11,
            color: "var(--af-text-secondary)",
            fontFamily: "var(--font-mono)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {event.model && <div>model: {event.model}</div>}
          {event.requestId && <div>request: {event.requestId}</div>}
          {event.messageId && <div>message: {event.messageId}</div>}
          {event.stopReason && <div>stop_reason: {event.stopReason}</div>}
          {event.usage && (
            <>
              <div style={{ marginTop: 6, opacity: 0.7 }}>tokens</div>
              <div> input: {event.usage.input.toLocaleString()}</div>
              <div> output: {event.usage.output.toLocaleString()}</div>
              <div> cache read: {event.usage.cacheRead.toLocaleString()}</div>
              <div>
                {"  "}cache write: {event.usage.cacheWrite.toLocaleString()}
              </div>
            </>
          )}
        </div>
      )}

      {/* Content */}
      <div style={{ padding: "18px 22px" }}>
        <DrawerContent event={event} row={row} />
      </div>
    </div>
  );
}

function drawerTitle(row: PresentationRow | null, event: SessionEvent): string {
  if (row) {
    switch (row.kind) {
      case "user":
        return "Message";
      case "agent":
        return "Message";
      case "tool-group":
        return `Tool use · ${formatToolSummary(row.toolNames)}`;
      case "interrupt":
        return "Interrupted";
      case "model":
        return "Model (zero-usage)";
      case "error":
        return "API error";
      case "task-notification":
        return `Background task · ${row.status}`;
    }
  }
  return event.rawType;
}

function DrawerContent({ event, row }: { event: SessionEvent; row: PresentationRow | null }) {
  // User rows can override their blocks (e.g. slash commands get a cleaned
  // "/implement AGE-8" block instead of the raw XML).
  if (row?.kind === "user" && row.displayBlocks) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {row.displayBlocks.map((b, i) => (
          <BlockView key={i} block={b} />
        ))}
      </div>
    );
  }

  // Task notifications: parsed fields in a clean key-value layout,
  // not the raw <task-notification> XML blob.
  if (row?.kind === "task-notification") {
    const statusColor =
      row.status === "success"
        ? "var(--af-success)"
        : row.status === "failed"
          ? "var(--af-danger)"
          : "var(--af-text-secondary)";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: 4,
              background:
                row.status === "success"
                  ? "var(--af-success-subtle)"
                  : row.status === "failed"
                    ? "var(--af-danger-subtle)"
                    : "var(--af-border-subtle)",
              color: statusColor,
              textTransform: "uppercase",
              letterSpacing: "0.03em",
            }}
          >
            {row.status}
          </span>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--af-text)" }}>{row.summary}</div>
        {(row.taskId || row.toolUseId || row.outputFile) && (
          <div
            style={{
              fontSize: 11,
              color: "var(--af-text-secondary)",
              fontFamily: "var(--font-mono)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              paddingTop: 10,
              borderTop: "1px solid var(--af-border-subtle)",
            }}
          >
            {row.taskId && <div>task id: {row.taskId}</div>}
            {row.toolUseId && <div>tool use: {row.toolUseId.slice(0, 24)}…</div>}
            {row.outputFile && (
              <div style={{ wordBreak: "break-all" }}>output: {row.outputFile}</div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Tool group: list all individual tool calls with their inputs
  if (row?.kind === "tool-group" && row.count > 1) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {row.events.map((e, i) => (
          <div key={e.index}>
            <div
              style={{
                fontSize: 11,
                color: "var(--af-text-tertiary)",
                marginBottom: 4,
                fontFamily: "var(--font-mono)",
              }}
            >
              #{i + 1} · {formatOffset(e.tOffsetMs)} · {e.toolUseId?.slice(0, 14)}…
            </div>
            {e.blocks.map((b, bi) => (
              <BlockView key={bi} block={b} />
            ))}
          </div>
        ))}
      </div>
    );
  }

  // Agent row: include thinking blocks from the same message.id if present
  if (row?.kind === "agent" && row.groupedEvents.length > 1) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {row.groupedEvents.flatMap((e, i) =>
          e.blocks.map((b, bi) => <BlockView key={`${i}-${bi}`} block={b} />),
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {event.blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ToolUseCard — pretty rendering of tool_use blocks                 */
/*                                                                     */
/*  Claude Code emits tool calls with varying input schemas. Raw JSON */
/*  dumps are unreadable; instead we dispatch on tool name and render */
/*  a human-friendly card tailored to each common tool.               */
/* ------------------------------------------------------------------ */

type ToolUseInput = Record<string, unknown> | unknown;

function shortenToolName(name: string): string {
  // mcp__plugin_linear_linear__get_issue → linear.get_issue
  const m = name.match(/^mcp__(?:plugin_)?([^_]+)_(?:\1_)?(.+)$/);
  if (m) return `${m[1]}.${m[2]}`;
  // mcp__claude_ai_Gmail__search_threads → gmail.search_threads
  const m2 = name.match(/^mcp__claude_ai_([^_]+)__(.+)$/);
  if (m2) return `${m2[1].toLowerCase()}.${m2[2]}`;
  return name;
}

/** Split an absolute path into (dir, filename) with an abbreviated dir
 *  (last 3 segments max) for compact display.  */
function splitPath(p: string): { dir: string; file: string } {
  const parts = p.split("/");
  const file = parts[parts.length - 1] ?? p;
  const dirParts = parts.slice(0, -1).filter(Boolean);
  let dir = dirParts.join("/");
  if (dirParts.length > 4) {
    dir = "…/" + dirParts.slice(-3).join("/");
  }
  return { dir, file };
}

function PathLabel({ path }: { path: string }) {
  const { dir, file } = splitPath(path);
  return (
    <code
      style={{
        fontSize: 12,
        background: "var(--af-border-subtle)",
        padding: "2px 8px",
        borderRadius: 4,
        fontFamily: "var(--font-mono)",
        color: "var(--af-text)",
      }}
    >
      {dir && <span style={{ color: "var(--af-text-tertiary)" }}>{dir}/</span>}
      <b style={{ fontWeight: 600 }}>{file}</b>
    </code>
  );
}

function ToolCardShell({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 8,
        background: "var(--background)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: children ? "1px solid var(--af-border-subtle)" : "none",
          fontSize: 12,
          color: "var(--af-text-secondary)",
        }}
      >
        <span style={{ fontSize: 13 }}>{icon}</span>
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}

function CodeBlock({ text, maxHeight = 280 }: { text: string; maxHeight?: number }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: "10px 12px",
        fontFamily: "var(--font-mono)",
        fontSize: 11.5,
        lineHeight: 1.55,
        color: "var(--af-text)",
        whiteSpace: "pre",
        overflow: "auto",
        maxHeight,
      }}
    >
      {text}
    </pre>
  );
}

function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  return (
    <pre
      style={{
        margin: 0,
        padding: "10px 12px",
        fontFamily: "var(--font-mono)",
        fontSize: 11.5,
        lineHeight: 1.55,
        whiteSpace: "pre",
        overflow: "auto",
        maxHeight: 320,
      }}
    >
      {oldLines.map((line, i) => (
        <div
          key={`o${i}`}
          style={{
            background: "rgba(220, 38, 38, 0.08)",
            color: "#991B1B",
            padding: "0 4px",
            borderLeft: "3px solid #DC2626",
          }}
        >
          <span style={{ opacity: 0.6, userSelect: "none" }}>− </span>
          {line || "\u00A0"}
        </div>
      ))}
      {newLines.map((line, i) => (
        <div
          key={`n${i}`}
          style={{
            background: "rgba(5, 150, 105, 0.08)",
            color: "#065F46",
            padding: "0 4px",
            borderLeft: "3px solid #059669",
          }}
        >
          <span style={{ opacity: 0.6, userSelect: "none" }}>+ </span>
          {line || "\u00A0"}
        </div>
      ))}
    </pre>
  );
}

function ToolUseCard({ name, input }: { name: string; input: ToolUseInput }) {
  const i = (input ?? {}) as Record<string, unknown>;
  const str = (k: string): string | undefined =>
    typeof i[k] === "string" ? (i[k] as string) : undefined;
  const num = (k: string): number | undefined =>
    typeof i[k] === "number" ? (i[k] as number) : undefined;

  // --- Write -------------------------------------------------------
  if (name === "Write") {
    const filePath = str("file_path") ?? "";
    const content = str("content") ?? "";
    return (
      <ToolCardShell
        icon="📝"
        label={
          <>
            <b>Write</b> <PathLabel path={filePath} />
          </>
        }
      >
        <CodeBlock text={content} />
      </ToolCardShell>
    );
  }

  // --- Edit --------------------------------------------------------
  if (name === "Edit") {
    const filePath = str("file_path") ?? "";
    const oldStr = str("old_string") ?? "";
    const newStr = str("new_string") ?? "";
    const replaceAll = i.replace_all === true;
    return (
      <ToolCardShell
        icon="✏️"
        label={
          <>
            <b>Edit</b> <PathLabel path={filePath} />
            {replaceAll && (
              <span
                style={{
                  fontSize: 10,
                  color: "var(--af-warning)",
                  background: "var(--af-warning-subtle)",
                  padding: "1px 6px",
                  borderRadius: 10,
                }}
              >
                replace all
              </span>
            )}
          </>
        }
      >
        <DiffView oldText={oldStr} newText={newStr} />
      </ToolCardShell>
    );
  }

  // --- Read --------------------------------------------------------
  if (name === "Read") {
    const filePath = str("file_path") ?? "";
    const offset = num("offset");
    const limit = num("limit");
    const range =
      offset !== undefined || limit !== undefined
        ? ` · lines ${offset ?? 1}${limit !== undefined ? `–${(offset ?? 0) + limit}` : "…"}`
        : "";
    return (
      <ToolCardShell
        icon="📖"
        label={
          <>
            <b>Read</b> <PathLabel path={filePath} />
            <span style={{ color: "var(--af-text-tertiary)" }}>{range}</span>
          </>
        }
      />
    );
  }

  // --- Bash --------------------------------------------------------
  if (name === "Bash") {
    const command = str("command") ?? "";
    const description = str("description");
    const runInBg = i.run_in_background === true;
    return (
      <ToolCardShell
        icon="⚡"
        label={
          <>
            <b>Bash</b>
            {description && (
              <span
                style={{
                  color: "var(--af-text)",
                  fontStyle: "italic",
                }}
              >
                {description}
              </span>
            )}
            {runInBg && (
              <span
                style={{
                  fontSize: 10,
                  color: "var(--af-info)",
                  background: "var(--af-info-subtle)",
                  padding: "1px 6px",
                  borderRadius: 10,
                }}
              >
                background
              </span>
            )}
          </>
        }
      >
        <CodeBlock text={command} maxHeight={220} />
      </ToolCardShell>
    );
  }

  // --- Grep --------------------------------------------------------
  if (name === "Grep") {
    const pattern = str("pattern") ?? "";
    const path = str("path");
    const glob = str("glob");
    const type = str("type");
    const outputMode = str("output_mode");
    return (
      <ToolCardShell
        icon="🔍"
        label={
          <>
            <b>Grep</b>{" "}
            <code
              style={{
                background: "var(--af-border-subtle)",
                padding: "1px 6px",
                borderRadius: 4,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
            >
              {pattern}
            </code>
            {path && (
              <>
                {" in "}
                <PathLabel path={path} />
              </>
            )}
            {(glob || type || outputMode) && (
              <span
                style={{
                  color: "var(--af-text-tertiary)",
                  fontSize: 11,
                  marginLeft: 6,
                }}
              >
                {[
                  glob && `glob=${glob}`,
                  type && `type=${type}`,
                  outputMode && `mode=${outputMode}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </>
        }
      />
    );
  }

  // --- Glob --------------------------------------------------------
  if (name === "Glob") {
    const pattern = str("pattern") ?? "";
    const path = str("path");
    return (
      <ToolCardShell
        icon="📁"
        label={
          <>
            <b>Glob</b>{" "}
            <code
              style={{
                background: "var(--af-border-subtle)",
                padding: "1px 6px",
                borderRadius: 4,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
            >
              {pattern}
            </code>
            {path && (
              <>
                {" in "}
                <PathLabel path={path} />
              </>
            )}
          </>
        }
      />
    );
  }

  // --- Skill -------------------------------------------------------
  if (name === "Skill") {
    const skill = str("skill") ?? "";
    const args = str("args");
    return (
      <ToolCardShell
        icon="🧩"
        label={
          <>
            <b>/{skill}</b>
            {args && <span style={{ color: "var(--af-text-secondary)" }}>{args}</span>}
          </>
        }
      />
    );
  }

  // --- ToolSearch --------------------------------------------------
  if (name === "ToolSearch") {
    const query = str("query") ?? "";
    const max = num("max_results");
    return (
      <ToolCardShell
        icon="🔎"
        label={
          <>
            <b>ToolSearch</b>{" "}
            <code
              style={{
                background: "var(--af-border-subtle)",
                padding: "1px 6px",
                borderRadius: 4,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
            >
              {query}
            </code>
            {max !== undefined && (
              <span style={{ color: "var(--af-text-tertiary)", fontSize: 11 }}>max={max}</span>
            )}
          </>
        }
      />
    );
  }

  // --- TodoWrite ---------------------------------------------------
  if (name === "TodoWrite") {
    const todos = Array.isArray(i.todos) ? (i.todos as Array<Record<string, unknown>>) : [];
    return (
      <ToolCardShell icon="✅" label={<b>TodoWrite · {todos.length} items</b>}>
        <div style={{ padding: "10px 12px", fontSize: 12 }}>
          {todos.map((t, ti) => {
            const status = String(t.status ?? "pending");
            const content =
              typeof t.content === "string"
                ? t.content
                : typeof t.activeForm === "string"
                  ? t.activeForm
                  : "";
            const icon = status === "completed" ? "✔" : status === "in_progress" ? "◐" : "○";
            return (
              <div
                key={ti}
                style={{
                  display: "flex",
                  gap: 8,
                  padding: "2px 0",
                  opacity: status === "completed" ? 0.6 : 1,
                  textDecoration: status === "completed" ? "line-through" : "none",
                }}
              >
                <span style={{ color: "var(--af-text-tertiary)" }}>{icon}</span>
                <span>{content}</span>
              </div>
            );
          })}
        </div>
      </ToolCardShell>
    );
  }

  // --- MCP tools (linear, slack, etc.) -----------------------------
  if (name.startsWith("mcp__")) {
    const short = shortenToolName(name);
    return (
      <ToolCardShell icon="🔌" label={<b>{short}</b>}>
        <CodeBlock text={JSON.stringify(input, null, 2)} maxHeight={200} />
      </ToolCardShell>
    );
  }

  // --- Fallback ----------------------------------------------------
  return (
    <ToolCardShell icon="🔧" label={<b>{name}</b>}>
      <CodeBlock text={JSON.stringify(input, null, 2)} maxHeight={220} />
    </ToolCardShell>
  );
}

function BlockView({ block }: { block: ContentBlock }) {
  if (block.type === "text") {
    return (
      <div className="sl-prose">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: (props) => (
              <a
                {...props}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "var(--af-accent)",
                  textDecoration: "underline",
                  textUnderlineOffset: 2,
                }}
              />
            ),
          }}
        >
          {block.text}
        </ReactMarkdown>
      </div>
    );
  }
  if (block.type === "thinking") {
    return (
      <details>
        <summary
          style={{
            cursor: "pointer",
            fontSize: 11,
            color: "var(--af-text-tertiary)",
            marginBottom: 6,
          }}
        >
          Thinking · {block.thinking.length} chars
        </summary>
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.6,
            color: "var(--af-text-secondary)",
            whiteSpace: "pre-wrap",
            fontStyle: "italic",
            borderLeft: "3px solid var(--af-border-subtle)",
            paddingLeft: 12,
            marginTop: 6,
          }}
        >
          {block.thinking}
        </div>
      </details>
    );
  }
  if (block.type === "tool_use") {
    return <ToolUseCard name={block.name} input={block.input} />;
  }
  if (block.type === "tool_result") {
    const text =
      typeof block.content === "string" ? block.content : JSON.stringify(block.content, null, 2);
    return (
      <pre
        style={{
          fontSize: 12,
          padding: 12,
          background: "var(--background)",
          border: "1px solid var(--af-border-subtle)",
          borderRadius: 6,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          color: "var(--af-text)",
          fontFamily: "var(--font-mono)",
          maxHeight: 500,
        }}
      >
        {text}
      </pre>
    );
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDurationHeader(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}
